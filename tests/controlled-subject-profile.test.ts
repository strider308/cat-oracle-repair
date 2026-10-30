import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical} from '../src/oracle/canonical.ts';
import {assertControlledCandidateLifecycle} from './controlled-candidate-lifecycle.ts';
import {assertExactOwnedManifestRows, assertExecutionInfrastructureIdentity, assertIndependentReproduction, createControlledBenchmarkReceipt, inventoryControlledTree, validateControlledBenchmarkSubject, verifyControlledBenchmarkReceipt, verifyFrozenSourceBytes} from '../src/benchmark/controlled-subject-profile.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profilePath = path.join(root, 'benchmark/protocol/controlled-subject-profile-v1.json');
const specPath = path.join(root, 'benchmark/protocol/controlled-mutation-spec-v1.json');
const matrixPath = path.join(root, 'benchmark/protocol/controlled-profile-acceptance-matrix-v1.json');
const trackedText = (value: Buffer) => Buffer.from(value.toString('binary').replace(/\r\n/g, '\n'), 'binary');
const frozenBytes = (filePath: string) => trackedText(readFileSync(filePath));
const profile = JSON.parse(frozenBytes(profilePath).toString('utf8'));
const spec = JSON.parse(frozenBytes(specPath).toString('utf8'));
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const rowsHash = (rows: unknown) => sha256(canonical(rows));

function validFixture() {
  const sourceRows = structuredClone(profile.base.sourceTree);
  const mutation = sourceRows.find((row: any) => row.path === spec.sourcePath);
  const baseSha256 = mutation.sha256;
  mutation.sha256 = 'a'.repeat(64);
  const runtimeRows = profile.base.sourceTree.filter((row: any) => profile.base.expectedRuntimeFiles.includes(row.path));
  const manifest = {version: 1, caseId: profile.caseId, candidateId: profile.candidateId, candidateRoot: profile.candidateRoot,
    entrypoint: 'index.js', files: runtimeRows, candidateHash: rowsHash(runtimeRows)};
  const profileSha256 = sha256(frozenBytes(profilePath));
  const mutationSpecSha256 = sha256(frozenBytes(specPath));
  const sourceCandidateHash = rowsHash(sourceRows);
  const runtimeCandidateHash = rowsHash(runtimeRows);
  const generationEvidence = {version: 1, profileSha256, mutationSpecSha256, manifestSha256: sha256(canonical(manifest)),
    generatorIdentity: {contractSha256: rowsHash(profile.generatorContract), generatorPath: profile.generatorContract.generatorPath, generatorSha256: 'd'.repeat(64)},
    baseIdentity: {caseId: profile.caseId, sourceTreeSha256: profile.base.sourceTreeSha256, lockfileSha256: profile.base.lockfileSha256},
    sourceCandidate: {fileCount: sourceRows.length, sha256: sourceCandidateHash, rows: sourceRows,
      changeBindings: [{path: spec.sourcePath, baseSha256, resultSha256: mutation.sha256}]},
    runtimeCandidate: {fileCount: runtimeRows.length, sha256: runtimeCandidateHash, rows: runtimeRows,
      builtFromSourceSha256: sourceCandidateHash,
      reproduction: {sourceCandidateSha256: sourceCandidateHash, runtimeCandidateSha256: runtimeCandidateHash}},
    dependencyIdentity: profile.dependencyIdentity,
    executionInfrastructureIdentitySha256: profile.executionInfrastructure.identitySha256};
  return {manifest, generationEvidence};
}

test('controlled profile schema invariants and pinned identities are valid', () => {
  const schema = JSON.parse(readFileSync(path.join(root, 'benchmark/schemas/controlled-subject-profile-v1.schema.json'), 'utf8'));
  assert.equal(profile.profileVersion, 'ControlledBenchmarkSubjectProfileV1');
  assert.equal(profile.maliciousCodeIsolationClaim, false);
  assert.equal(profile.arbitraryExternalSubjectSupport, 'NOT_APPROVED');
  assert.equal(profile.candidateCreated, false);
  assert.equal(profile.competitiveLanesExecuted, false);
  for (const key of schema.required) assert.ok(Object.hasOwn(profile, key), `schema-required property ${key}`);
  assert.equal(profile.base.sourceTreeFileCount, profile.base.sourceTree.length);
  assert.equal(profile.base.sourceTreeSha256, rowsHash(profile.base.sourceTree));
  assert.equal(profile.dependencyIdentity.fileCount, 4219);
  assert.equal(profile.base.expectedRuntimeFiles.join(','), 'index.js,lib/node_cache.js');
  const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
  assert.equal(sha256(frozenBytes(matrixPath)), profile.acceptanceMatrixSha256);
  assert.equal(matrix.controlledProfileRequirements.length, 38);
  assert.ok(matrix.controlledProfileRequirements.every((item: any) => item.status === 'PASS'));
  assert.ok(matrix.productionSandboxGaps.every((item: any) => item.status === 'OUT_OF_SCOPE'));
  assert.equal(profile.generatorContract.implementationStatus, 'IMPLEMENTED_NOT_RUN_ON_REAL_MUTATION');
});

test('mutation spec freezes one exact transform without outcome or fallback fields', () => {
  assert.equal(spec.specVersion, 'ControlledMutationSpecV1');
  assert.equal(spec.behavioralClass, 'TTL_ZERO_DELETES_EXISTING_ENTRY');
  assert.deepEqual(spec.allowedChangedSourcePaths, [spec.sourcePath]);
  assert.equal(spec.transform.matchCount, 1);
  assert.equal(spec.transform.oldText, 'if ttl >= 0');
  assert.equal(spec.transform.newText, 'if ttl > 0');
  assert.deepEqual(spec.alternatives, []);
  assert.deepEqual(spec.fallbacks, []);
  assert.equal(spec.outcomeBasedSelection, 'PROHIBITED');
  assert.equal(Object.keys(spec).some((key) => /expected(?:Decision|Result|Winner|Score|B[0-4])/i.test(key)), false);
  const source = readFileSync(path.join(root, profile.base.sourceRoot, spec.sourcePath), 'utf8');
  assert.equal(source.split(spec.transform.oldText).length - 1, 1);
});

test('controlled benchmark rejects synthetic hashes without materialized source and runtime bytes', () => {
  const {manifest, generationEvidence} = validFixture();
  assert.throws(() => validateControlledBenchmarkSubject(manifest, generationEvidence, root));
});

test('frozen source verifier accepts only the exact one-file transform', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'cat-controlled-source-'));
  const baseRoot = path.join(temp, 'base');
  const candidateRoot = path.join(temp, 'candidate');
  mkdirSync(path.join(baseRoot, '_src', 'lib'), {recursive: true});
  mkdirSync(path.join(candidateRoot, '_src', 'lib'), {recursive: true});
  mkdirSync(path.join(baseRoot, 'lib'));
  mkdirSync(path.join(candidateRoot, 'lib'));
  const original = 'if ttl >= 0\nkeep';
  writeFileSync(path.join(baseRoot, '_src/lib/node_cache.coffee'), original);
  writeFileSync(path.join(candidateRoot, '_src/lib/node_cache.coffee'), 'if ttl > 0\nkeep');
  writeFileSync(path.join(baseRoot, 'lib/unchanged.js'), 'same');
  writeFileSync(path.join(candidateRoot, 'lib/unchanged.js'), 'same');
  const fixtureSpec = {...spec, sourcePath: '_src/lib/node_cache.coffee', allowedChangedSourcePaths: ['_src/lib/node_cache.coffee'],
    transform: {...spec.transform, oldText: 'if ttl >= 0', newText: 'if ttl > 0'}};
  try {
    assert.equal(verifyFrozenSourceBytes(baseRoot, candidateRoot, fixtureSpec).length, 2);
    writeFileSync(path.join(candidateRoot, '_src/lib/node_cache.coffee'), 'fabricated bytes');
    assert.throws(() => verifyFrozenSourceBytes(baseRoot, candidateRoot, fixtureSpec), /CONTROLLED_SOURCE_BYTES_INVALID/);
  } finally { rmSync(temp, {recursive: true, force: true}); }
});

test('copied reproduction claims cannot replace independently inventoried bytes', () => {
  const source = [{path: '_src/entry.coffee', sha256: 'a'.repeat(64)}];
  const runtime = [{path: 'index.js', sha256: 'b'.repeat(64)}];
  assert.throws(() => assertIndependentReproduction(source, runtime, source, [{path: 'index.js', sha256: 'c'.repeat(64)}]), /CONTROLLED_REPRODUCTION_IDENTITY_INVALID/);
});

test('extra candidate-owned manifest rows are rejected', () => {
  const runtime = [{path: 'index.js', sha256: 'a'.repeat(64)}];
  assert.throws(() => assertExactOwnedManifestRows([...runtime, {path: 'extra.js', sha256: 'b'.repeat(64)}], runtime), /CONTROLLED_MANIFEST_RUNTIME_MISMATCH/);
});

test('an arbitrary manifest without controlled generation evidence is rejected', () => {
  const {manifest} = validFixture();
  assert.throws(() => validateControlledBenchmarkSubject(manifest, null, root), /CONTROLLED_GENERATION_EVIDENCE_REQUIRED/);
});

test('profile hash mismatch is rejected', () => {
  const {manifest, generationEvidence} = validFixture();
  generationEvidence.profileSha256 = '0'.repeat(64);
  assert.throws(() => validateControlledBenchmarkSubject(manifest, generationEvidence, root), /CONTROLLED_GENERATION_BINDING_INVALID/);
});

test('mutation-spec hash mismatch is rejected', () => {
  const {manifest, generationEvidence} = validFixture();
  generationEvidence.mutationSpecSha256 = '0'.repeat(64);
  assert.throws(() => validateControlledBenchmarkSubject(manifest, generationEvidence, root), /CONTROLLED_GENERATION_BINDING_INVALID/);
});

test('base identity mismatch is rejected', () => {
  const {manifest, generationEvidence} = validFixture();
  generationEvidence.baseIdentity.sourceTreeSha256 = '0'.repeat(64);
  assert.throws(() => validateControlledBenchmarkSubject(manifest, generationEvidence, root), /CONTROLLED_GENERATION_BINDING_INVALID/);
});

test('unsupported changed source path is rejected', () => {
  const {manifest, generationEvidence} = validFixture();
  const row = generationEvidence.sourceCandidate.rows.find((item: any) => item.path === 'package.json');
  row.sha256 = 'b'.repeat(64);
  generationEvidence.sourceCandidate.rows.sort((a: any, b: any) => a.path < b.path ? -1 : 1);
  generationEvidence.sourceCandidate.sha256 = rowsHash(generationEvidence.sourceCandidate.rows);
  generationEvidence.runtimeCandidate.builtFromSourceSha256 = generationEvidence.sourceCandidate.sha256;
  generationEvidence.runtimeCandidate.reproduction.sourceCandidateSha256 = generationEvidence.sourceCandidate.sha256;
  generationEvidence.sourceCandidate.changeBindings = [{path: spec.sourcePath, baseSha256: spec.baseFileSha256, resultSha256: 'a'.repeat(64)}];
  assert.throws(() => validateControlledBenchmarkSubject(manifest, generationEvidence, root));
});

test('dependency inventory is deterministic and matches the locked fixture tree', () => {
  const dependencyRoot = path.join(root, profile.dependencyIdentity.root);
  const first = inventoryControlledTree(dependencyRoot);
  const second = inventoryControlledTree(dependencyRoot);
  assert.equal(first.length, profile.dependencyIdentity.fileCount);
  assert.equal(rowsHash(first), profile.dependencyIdentity.inventorySha256);
  assert.equal(rowsHash(second), rowsHash(first));
  assert.equal(sha256(readFileSync(path.join(root, profile.base.lockfilePath))), profile.dependencyIdentity.lockfileSha256);
});

test('sensitive roots fail closed during inventory', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'cat-controlled-inventory-'));
  try {
    writeFileSync(path.join(temp, 'safe.txt'), 'safe');
    mkdirSync(path.join(temp, '.gortex'));
    writeFileSync(path.join(temp, '.gortex', 'private.txt'), 'private');
    mkdirSync(path.join(temp, '.agent-runs'));
    writeFileSync(path.join(temp, '.agent-runs', 'receipt.json'), '{}');
    assert.throws(() => inventoryControlledTree(temp), /CONTROLLED_INVENTORY_SENSITIVE_PATH_REJECTED/);
  } finally { rmSync(temp, {recursive: true, force: true}); }
});

test('execution infrastructure identity binds the evaluator descriptor and receipts bind candidate identities', () => {
  const infrastructure = {...profile.executionInfrastructure};
  delete infrastructure.identitySha256;
  assert.equal(rowsHash(infrastructure), profile.executionInfrastructure.identitySha256);
  assertExecutionInfrastructureIdentity(root, profile.executionInfrastructure);
  assert.throws(() => assertExecutionInfrastructureIdentity(root, {...profile.executionInfrastructure, executorSha256: '0'.repeat(64)}), /CONTROLLED_EXECUTION_INFRASTRUCTURE_MISMATCH/);
  const validated = {profileSha256: sha256(frozenBytes(profilePath)), mutationSpecSha256: sha256(frozenBytes(specPath)),
    sourceCandidateHash: 'a'.repeat(64), runtimeCandidateHash: 'b'.repeat(64), dependencyIdentity: profile.dependencyIdentity,
    executionInfrastructureIdentitySha256: profile.executionInfrastructure.identitySha256, freezeCommitSha: 'c'.repeat(40),
    generationEvidenceSha256: 'd'.repeat(64), challengeManifestSha256: 'e'.repeat(64)} as any;
  const receipt = createControlledBenchmarkReceipt({runId: '0f0f0f0f-0000-4000-8000-000000000001', createdAt: '2026-10-13T12:00:00.000Z',
    receiptPath: 'evidence/p03-subject-receipts/0f0f0f0f-0000-4000-8000-000000000001.json', receiptHash: 'c'.repeat(64),
    jobStatus: 'COMPLETED', decision: 'ACCEPTED'}, validated);
  assert.equal(receipt.maliciousCodeIsolationClaim, false);
  assert.equal(receipt.sourceCandidateHash, validated.sourceCandidateHash);
  assert.equal(receipt.runtimeCandidateHash, validated.runtimeCandidateHash);
  assert.equal(verifyControlledBenchmarkReceipt(receipt), true);
  assert.equal(verifyControlledBenchmarkReceipt({...receipt, maliciousCodeIsolationClaim: true}), false);
});

test('CLI requires a freeze commit anchor or explicit infrastructure-test mode', () => {
  const script = path.join(root, 'scripts/cat-subject.ts');
  let stderr = '';
  try { execFileSync(process.execPath, ['--experimental-strip-types', script, '--candidate-manifest', 'candidate.json'], {cwd: root, stdio: ['ignore', 'ignore', 'pipe']}); }
  catch (error: any) { stderr = error.stderr.toString('utf8'); assert.equal(error.status, 2); }
  assert.match(stderr, /CONTROLLED_FREEZE_COMMIT_REQUIRED/);
});

test('candidate and reproduction paths are absent at generation authority and present at artifact commit', () => {
  assertControlledCandidateLifecycle(root);
  assert.deepEqual(execFileSync('git', ['ls-files', '--', 'benchmark/results'], {cwd: root, encoding: 'utf8'}).trim().split(/\r?\n/), ['benchmark/results/.gitkeep']);
});
