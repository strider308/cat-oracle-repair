import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical} from '../oracle/canonical.ts';
import {P03_SUBJECT_EXECUTION_INFRASTRUCTURE} from '../evaluation/p03-subject.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILE_PATH = 'benchmark/protocol/controlled-subject-profile-v1.json';
const SPEC_PATH = 'benchmark/protocol/controlled-mutation-spec-v1.json';
const MATRIX_PATH = 'benchmark/protocol/controlled-profile-acceptance-matrix-v1.json';
const LOCK_PATH = 'fixtures/hero/node-cache-ttl-zero-001/suite/package-lock.json';
const HASH = /^[a-f0-9]{64}$/;
const SENSITIVE = new Set(['.gortex', '.git', '.agent-runs']);
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const rowsHash = (rows: unknown) => digest(canonical(rows));
const trackedText = (value: Buffer) => Buffer.from(value.toString('binary').replace(/\r\n/g, '\n'), 'binary');

type InventoryRow = {path: string; sha256: string};

export function inventoryControlledTree(directory: string): InventoryRow[] {
  const root = path.resolve(directory);
  if (!lstatSync(root).isDirectory()) throw new Error('CONTROLLED_INVENTORY_ROOT_INVALID');
  const rows: InventoryRow[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, {withFileTypes: true})) {
      if (SENSITIVE.has(entry.name.toLowerCase())) throw new Error('CONTROLLED_INVENTORY_SENSITIVE_PATH_REJECTED');
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('CONTROLLED_INVENTORY_LINK_REJECTED');
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) rows.push({path: path.relative(root, target).split(path.sep).join('/'), sha256: digest(readFileSync(target))});
      else throw new Error('CONTROLLED_INVENTORY_ENTRY_REJECTED');
    }
  };
  walk(root);
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function readFrozen(root: string) {
  const profileBytes = trackedText(readFileSync(path.join(root, PROFILE_PATH)));
  const specBytes = trackedText(readFileSync(path.join(root, SPEC_PATH)));
  const matrixBytes = trackedText(readFileSync(path.join(root, MATRIX_PATH)));
  const profile = JSON.parse(profileBytes.toString('utf8'));
  const spec = JSON.parse(specBytes.toString('utf8'));
  const matrix = JSON.parse(matrixBytes.toString('utf8'));
  const profileSha256 = digest(profileBytes);
  const mutationSpecSha256 = digest(specBytes);
  if (profile.profileVersion !== 'ControlledBenchmarkSubjectProfileV1' || profile.caseId !== 'node-cache-ttl-zero-001' ||
      profile.status !== 'READY_FOR_OWNER_FREEZE_REVIEW' || profile.maliciousCodeIsolationClaim !== false ||
      profile.arbitraryExternalSubjectSupport !== 'NOT_APPROVED' || profile.candidateCreated !== false ||
      profile.competitiveLanesExecuted !== false || profile.mutationSpecPath !== SPEC_PATH ||
      profile.candidateId !== 'dp05b-controlled-v1' || profile.candidateBundleRoot !== 'fixtures/hero/node-cache-ttl-zero-001/candidates/dp05b-controlled-v1' ||
      profile.candidateSourceRoot !== profile.candidateBundleRoot + '/source' || profile.candidateRoot !== profile.candidateBundleRoot + '/runtime' ||
      profile.reproductionSourceRoot !== profile.candidateBundleRoot + '/reproduction/source' ||
      profile.reproductionRuntimeRoot !== profile.candidateBundleRoot + '/reproduction/runtime' ||
      profile.mutationSpecSha256 !== mutationSpecSha256 || profile.acceptanceMatrixPath !== MATRIX_PATH ||
      profile.acceptanceMatrixSha256 !== digest(matrixBytes) || matrix.matrixVersion !== 'ControlledProfileAcceptanceMatrixV1' ||
      matrix.threatModel !== 'CONTROLLED_REPRODUCIBLE_MUTATION_V1' || matrix.controlledProfileRequirements?.length !== 38 ||
      matrix.controlledProfileRequirements.some((item: any) => item.status !== 'PASS') || matrix.productionSandboxGaps?.length !== 3 ||
      matrix.productionSandboxGaps.some((item: any) => item.status !== 'OUT_OF_SCOPE') ||
      profile.generatorContract?.contractVersion !== 'ControlledCandidateGeneratorV1' ||
      profile.generatorContract.implementationStatus !== 'IMPLEMENTED_NOT_RUN_ON_REAL_MUTATION' || profile.generatorContract.noPostGenerationChanges !== true ||
      spec.behavioralClass !== 'TTL_ZERO_DELETES_EXISTING_ENTRY' || spec.specVersion !== 'ControlledMutationSpecV1' ||
      spec.caseId !== profile.caseId || spec.baseSourceRoot !== profile.base.sourceRoot || spec.alternatives?.length !== 0 ||
      spec.fallbacks?.length !== 0 || spec.outcomeBasedSelection !== 'PROHIBITED' ||
      canonical(spec.allowedChangedSourcePaths) !== canonical([spec.sourcePath]) || spec.transform?.matchCount !== 1 ||
      typeof spec.transform.oldText !== 'string' || typeof spec.transform.newText !== 'string' || spec.transform.oldText === spec.transform.newText ||
      Object.keys(spec).some((key) => /expected(?:Decision|Result|Winner|Score|B[0-4])/i.test(key))) throw new Error('CONTROLLED_PROFILE_INVALID');
  const infrastructure = {...profile.executionInfrastructure};
  delete infrastructure.identitySha256;
  if (profile.executionInfrastructure.class !== 'LOCAL_CONTAINER_EXECUTION_BOUNDARY' ||
      profile.executionInfrastructure.identitySha256 !== rowsHash(infrastructure)) throw new Error('CONTROLLED_INFRASTRUCTURE_IDENTITY_INVALID');
  return {profile, spec, profileSha256, mutationSpecSha256};
}

function assertFrozenInputs(root: string, profile: any, spec: any) {
  const baseRoot = path.resolve(root, profile.base.sourceRoot);
  const baseRows = inventoryControlledTree(baseRoot);
  const lockPath = path.resolve(root, profile.base.lockfilePath);
  const dependencyRoot = path.resolve(root, profile.dependencyIdentity.root);
  const dependencyRows = inventoryControlledTree(dependencyRoot);
  const baseBytes = readFileSync(path.resolve(baseRoot, spec.sourcePath));
  const oldText = Buffer.from(spec.transform.oldText, 'utf8');
  const baseText = baseBytes.toString('utf8');
  if (baseRows.length !== profile.base.sourceTreeFileCount || rowsHash(baseRows) !== profile.base.sourceTreeSha256 ||
      canonical(baseRows) !== canonical(profile.base.sourceTree) || digest(readFileSync(lockPath)) !== profile.base.lockfileSha256 ||
      digest(readFileSync(lockPath)) !== profile.dependencyIdentity.lockfileSha256 ||
      dependencyRows.length !== profile.dependencyIdentity.fileCount || rowsHash(dependencyRows) !== profile.dependencyIdentity.inventorySha256 ||
      digest(baseBytes) !== spec.baseFileSha256 || baseText.split(spec.transform.oldText).length - 1 !== 1 || oldText.length === 0) {
    throw new Error('CONTROLLED_FROZEN_INPUT_MISMATCH');
  }
  assertExecutionInfrastructureIdentity(root, profile.executionInfrastructure);
  return {baseRoot, baseRows, dependencyRoot, dependencyRows};
}

export function assertExecutionInfrastructureIdentity(root: string, infrastructure: any) {
  if (digest(trackedText(readFileSync(path.resolve(root, infrastructure.adapterPath)))) !== infrastructure.adapterSha256 ||
      digest(trackedText(readFileSync(path.resolve(root, infrastructure.executorPath)))) !== infrastructure.executorSha256 ||
      canonical(P03_SUBJECT_EXECUTION_INFRASTRUCTURE) !== canonical(infrastructure.descriptor)) {
    throw new Error('CONTROLLED_EXECUTION_INFRASTRUCTURE_MISMATCH');
  }
}

export function verifyFrozenSourceBytes(baseRoot: string, sourceRoot: string, spec: any) {
  const baseRows = inventoryControlledTree(baseRoot);
  const sourceRows = inventoryControlledTree(sourceRoot);
  const baseByPath = new Map(baseRows.map((row) => [row.path, row.sha256]));
  const sourceByPath = new Map(sourceRows.map((row) => [row.path, row.sha256]));
  const changed = [...new Set([...baseByPath.keys(), ...sourceByPath.keys()])].filter((file) => baseByPath.get(file) !== sourceByPath.get(file)).sort();
  const baseBytes = readFileSync(path.join(baseRoot, ...spec.sourcePath.split('/')));
  const actualBytes = readFileSync(path.join(sourceRoot, ...spec.sourcePath.split('/')));
  const oldText = Buffer.from(spec.transform.oldText, 'utf8');
  const newText = Buffer.from(spec.transform.newText, 'utf8');
  const baseText = baseBytes.toString('utf8');
  const expected = Buffer.from(baseText.replace(spec.transform.oldText, spec.transform.newText), 'utf8');
  if (baseBytes.toString('utf8').split(spec.transform.oldText).length - 1 !== 1 || oldText.length === 0 ||
      canonical(changed) !== canonical(spec.allowedChangedSourcePaths) || sourceRows.length !== baseRows.length ||
      !actualBytes.equals(expected) || actualBytes.equals(baseBytes) || !newText.length) throw new Error('CONTROLLED_SOURCE_BYTES_INVALID');
  for (const row of baseRows) {
    if (row.path !== spec.sourcePath && sourceByPath.get(row.path) !== row.sha256) throw new Error('CONTROLLED_SOURCE_BYTES_INVALID');
  }
  return sourceRows;
}

export function assertIndependentReproduction(sourceRows: InventoryRow[], runtimeRows: InventoryRow[],
  reproductionSourceRows: InventoryRow[], reproductionRuntimeRows: InventoryRow[]) {
  if (canonical(reproductionSourceRows) !== canonical(sourceRows) || canonical(reproductionRuntimeRows) !== canonical(runtimeRows)) {
    throw new Error('CONTROLLED_REPRODUCTION_IDENTITY_INVALID');
  }
}

export function assertExactOwnedManifestRows(manifestRows: InventoryRow[], runtimeRows: InventoryRow[]) {
  if (canonical(manifestRows) !== canonical(runtimeRows)) throw new Error('CONTROLLED_MANIFEST_RUNTIME_MISMATCH');
}

function validRows(value: any): value is InventoryRow[] {
  return Array.isArray(value) && value.length > 0 && value.every((row, index) => row && typeof row.path === 'string' &&
    /^[a-zA-Z0-9._/-]+$/.test(row.path) && !row.path.split('/').some((part) => !part || part === '.' || part === '..' || SENSITIVE.has(part.toLowerCase())) &&
    HASH.test(row.sha256) && (!index || value[index - 1].path < row.path));
}

export function validateControlledBenchmarkSubject(manifest: any, generationEvidence: any, root = ROOT) {
  if (!manifest || typeof manifest !== 'object' || !generationEvidence || typeof generationEvidence !== 'object') throw new Error('CONTROLLED_GENERATION_EVIDENCE_REQUIRED');
  const {profile, spec, profileSha256, mutationSpecSha256} = readFrozen(root);
  const keys = ['baseIdentity', 'dependencyIdentity', 'executionInfrastructureIdentitySha256', 'generatorIdentity', 'manifestSha256', 'mutationSpecSha256',
    'profileSha256', 'runtimeCandidate', 'sourceCandidate', 'version'];
  if (canonical(Object.keys(generationEvidence).sort()) !== canonical(keys) || generationEvidence.version !== 1 ||
      generationEvidence.profileSha256 !== profileSha256 || generationEvidence.mutationSpecSha256 !== mutationSpecSha256 ||
      generationEvidence.manifestSha256 !== digest(canonical(manifest)) ||
      generationEvidence.executionInfrastructureIdentitySha256 !== profile.executionInfrastructure.identitySha256 ||
      canonical(Object.keys(manifest).sort()) !== canonical(['candidateHash', 'candidateId', 'candidateRoot', 'caseId', 'entrypoint', 'files', 'version'].sort()) ||
      manifest.version !== 1 || manifest.caseId !== profile.caseId || manifest.candidateId !== profile.candidateId ||
      manifest.candidateRoot !== profile.candidateRoot || manifest.entrypoint !== 'index.js' ||
      canonical(generationEvidence.dependencyIdentity) !== canonical(profile.dependencyIdentity) ||
      canonical(generationEvidence.baseIdentity) !== canonical({caseId: profile.caseId, sourceTreeSha256: profile.base.sourceTreeSha256,
        lockfileSha256: profile.base.lockfileSha256}) || !generationEvidence.sourceCandidate || !generationEvidence.runtimeCandidate) {
    throw new Error('CONTROLLED_GENERATION_BINDING_INVALID');
  }
  const {baseRoot, baseRows, dependencyRoot, dependencyRows} = assertFrozenInputs(root, profile, spec);
  const generatorIdentity = generationEvidence.generatorIdentity;
  if (canonical(Object.keys(generatorIdentity ?? {}).sort()) !== canonical(['contractSha256', 'generatorPath', 'generatorSha256']) ||
      generatorIdentity.generatorPath !== profile.generatorContract.generatorPath ||
      generatorIdentity.contractSha256 !== rowsHash(profile.generatorContract) ||
      generatorIdentity.generatorSha256 !== digest(readFileSync(path.resolve(root, generatorIdentity.generatorPath)))) {
    throw new Error('CONTROLLED_GENERATOR_IDENTITY_INVALID');
  }

  const source = generationEvidence.sourceCandidate;
  const runtime = generationEvidence.runtimeCandidate;
  if (canonical(Object.keys(source).sort()) !== canonical(['changeBindings', 'fileCount', 'rows', 'sha256']) ||
      canonical(Object.keys(runtime).sort()) !== canonical(['builtFromSourceSha256', 'fileCount', 'reproduction', 'rows', 'sha256']) ||
      canonical(Object.keys(runtime.reproduction ?? {}).sort()) !== canonical(['runtimeCandidateSha256', 'sourceCandidateSha256']) ||
      !validRows(source.rows) || source.fileCount !== source.rows.length || source.sha256 !== rowsHash(source.rows) ||
      !validRows(runtime.rows) || runtime.fileCount !== runtime.rows.length || runtime.sha256 !== rowsHash(runtime.rows) ||
      runtime.builtFromSourceSha256 !== source.sha256 || !runtime.reproduction ||
      runtime.reproduction.sourceCandidateSha256 !== source.sha256 || runtime.reproduction.runtimeCandidateSha256 !== runtime.sha256) {
    throw new Error('CONTROLLED_CANDIDATE_IDENTITY_INVALID');
  }
  const sourceRoot = path.resolve(root, profile.candidateSourceRoot);
  const runtimeRoot = path.resolve(root, profile.candidateRoot);
  const reproductionSourceRoot = path.resolve(root, profile.reproductionSourceRoot);
  const reproductionRuntimeRoot = path.resolve(root, profile.reproductionRuntimeRoot);
  const sourceRows = verifyFrozenSourceBytes(baseRoot, sourceRoot, spec);
  const actualRuntimeAllRows = inventoryControlledTree(runtimeRoot);
  const actualRuntimeRows = actualRuntimeAllRows.filter((row) => !row.path.startsWith('node_modules/'));
  const actualDependencyRows = actualRuntimeAllRows.filter((row) => row.path.startsWith('node_modules/')).map((row) => ({path: row.path.slice('node_modules/'.length), sha256: row.sha256}));
  const reproductionSourceRows = inventoryControlledTree(reproductionSourceRoot);
  const reproductionRuntimeAllRows = inventoryControlledTree(reproductionRuntimeRoot);
  const reproductionRuntimeRows = reproductionRuntimeAllRows.filter((row) => !row.path.startsWith('node_modules/'));
  const baseByPath = new Map(baseRows.map((row) => [row.path, row.sha256]));
  const sourceByPath = new Map(sourceRows.map((row) => [row.path, row.sha256]));
  const bindings = source.changeBindings;
  if (canonical(source.rows) !== canonical(sourceRows) ||
      !Array.isArray(bindings) || bindings.length !== 1 ||
      canonical(bindings) !== canonical([{path: spec.sourcePath, baseSha256: baseByPath.get(spec.sourcePath), resultSha256: sourceByPath.get(spec.sourcePath)}]) ||
      canonical(actualRuntimeRows) !== canonical(runtime.rows) ||
      canonical(actualRuntimeRows.map((row) => row.path)) !== canonical(profile.base.expectedRuntimeFiles)) {
    throw new Error('CONTROLLED_MATERIALIZED_BYTES_MISMATCH');
  }
  assertIndependentReproduction(sourceRows, actualRuntimeRows, reproductionSourceRows, reproductionRuntimeRows);

  const manifestRowsArray = Array.isArray(manifest.files) ? manifest.files.map((row: any) => ({path: row?.path, sha256: row?.sha256})) : [];
  const manifestRows = new Map(manifestRowsArray.map((row: any) => [row.path, row.sha256]));
  const ownedManifestRows = manifestRowsArray.filter((row: any) => typeof row.path === 'string' && !row.path.startsWith('node_modules/')).sort((a: any, b: any) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const manifestDependencyRows = manifestRowsArray.filter((row: any) => typeof row.path === 'string' && row.path.startsWith('node_modules/'))
    .map((row: any) => ({path: row.path.slice('node_modules/'.length), sha256: row.sha256})).sort((a: any, b: any) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (manifest.candidateHash !== digest(canonical(manifest.files?.map((row: any) => ({path: row.path, sha256: row.sha256})).sort((a: any, b: any) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) ||
      manifestDependencyRows.length !== new Set(manifestDependencyRows.map((row: any) => row.path)).size || canonical(manifestDependencyRows) !== canonical(actualDependencyRows)) {
    throw new Error('CONTROLLED_MANIFEST_RUNTIME_MISMATCH');
  }
  assertExactOwnedManifestRows(ownedManifestRows, actualRuntimeRows);
  const dependencyByPath = new Map(dependencyRows.map((row) => [row.path, row.sha256]));
  if (manifestDependencyRows.some((row: InventoryRow) => dependencyByPath.get(row.path) !== row.sha256) ||
      actualDependencyRows.some((row) => dependencyByPath.get(row.path) !== row.sha256) ||
      manifestDependencyRows.some((row: InventoryRow) => !actualDependencyRows.some((actual) => actual.path === row.path && actual.sha256 === row.sha256))) {
    throw new Error('CONTROLLED_MANIFEST_DEPENDENCY_MISMATCH');
  }
  const reproduction = runtime.reproduction;
  if (rowsHash(reproductionSourceRows) !== reproduction.sourceCandidateSha256 || rowsHash(reproductionRuntimeRows) !== reproduction.runtimeCandidateSha256 ||
      reproduction.sourceCandidateSha256 !== source.sha256 || reproduction.runtimeCandidateSha256 !== runtime.sha256) throw new Error('CONTROLLED_REPRODUCTION_IDENTITY_INVALID');
  return {profile, spec, profileSha256, mutationSpecSha256, sourceCandidateHash: source.sha256,
    runtimeCandidateHash: runtime.sha256, dependencyIdentity: profile.dependencyIdentity,
    executionInfrastructureIdentitySha256: profile.executionInfrastructure.identitySha256};
}

export function createControlledBenchmarkReceipt(subjectReceipt: any, validated: ReturnType<typeof validateControlledBenchmarkSubject>) {
  const payload = {receiptVersion: 1, receiptKind: 'CONTROLLED_BENCHMARK_SUBJECT_V1', runId: subjectReceipt.runId,
    createdAt: subjectReceipt.createdAt, receiptPath: `evidence/controlled-benchmark-receipts/${subjectReceipt.runId}.json`,
    threatModel: 'CONTROLLED_REPRODUCIBLE_MUTATION_V1', maliciousCodeIsolationClaim: false,
    profileSha256: validated.profileSha256, mutationSpecSha256: validated.mutationSpecSha256,
    sourceCandidateHash: validated.sourceCandidateHash, runtimeCandidateHash: validated.runtimeCandidateHash,
    freezeCommitSha: (validated as any).freezeCommitSha, generationEvidenceSha256: (validated as any).generationEvidenceSha256,
    challengeManifestSha256: (validated as any).challengeManifestSha256,
    dependencyIdentity: validated.dependencyIdentity, executionInfrastructureIdentitySha256: validated.executionInfrastructureIdentitySha256,
    subjectReceiptPath: subjectReceipt.receiptPath, subjectReceiptHash: subjectReceipt.receiptHash,
    jobStatus: subjectReceipt.jobStatus, decision: subjectReceipt.decision};
  return {...payload, receiptHash: digest(canonical(payload))};
}

export function verifyControlledBenchmarkReceipt(receipt: any) {
  if (!receipt || receipt.receiptVersion !== 1 || receipt.receiptKind !== 'CONTROLLED_BENCHMARK_SUBJECT_V1' ||
      receipt.threatModel !== 'CONTROLLED_REPRODUCIBLE_MUTATION_V1' || receipt.maliciousCodeIsolationClaim !== false ||
      canonical(Object.keys(receipt).sort()) !== canonical(['createdAt', 'decision', 'dependencyIdentity', 'executionInfrastructureIdentitySha256',
        'freezeCommitSha', 'generationEvidenceSha256', 'challengeManifestSha256', 'jobStatus', 'maliciousCodeIsolationClaim', 'mutationSpecSha256', 'profileSha256', 'receiptHash', 'receiptKind', 'receiptPath',
        'receiptVersion', 'runId', 'runtimeCandidateHash', 'sourceCandidateHash', 'subjectReceiptHash', 'subjectReceiptPath', 'threatModel'].sort()) ||
      typeof receipt.runId !== 'string' || receipt.receiptPath !== `evidence/controlled-benchmark-receipts/${receipt.runId}.json` ||
      receipt.subjectReceiptPath !== `evidence/p03-subject-receipts/${receipt.runId}.json` ||
      !['COMPLETED', 'INCONCLUSIVE'].includes(receipt.jobStatus) || ![null, 'ACCEPTED', 'REJECTED'].includes(receipt.decision) ||
      !HASH.test(receipt.profileSha256 ?? '') || !HASH.test(receipt.mutationSpecSha256 ?? '') ||
      !/^[a-f0-9]{40}$/.test(receipt.freezeCommitSha ?? '') || !HASH.test(receipt.generationEvidenceSha256 ?? '') || !HASH.test(receipt.challengeManifestSha256 ?? '') ||
      !HASH.test(receipt.sourceCandidateHash ?? '') || !HASH.test(receipt.runtimeCandidateHash ?? '') ||
      !HASH.test(receipt.executionInfrastructureIdentitySha256 ?? '') || !HASH.test(receipt.subjectReceiptHash ?? '') ||
      !receipt.dependencyIdentity || !HASH.test(receipt.dependencyIdentity.inventorySha256 ?? '') ||
      !HASH.test(receipt.dependencyIdentity.lockfileSha256 ?? '') || !Number.isInteger(receipt.dependencyIdentity.fileCount)) return false;
  const {receiptHash, ...payload} = receipt;
  return receiptHash === digest(canonical(payload));
}
