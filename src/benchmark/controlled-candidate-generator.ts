import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {isBuiltin} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {canonical} from '../oracle/canonical.ts';
import {loadFrozenControlsV2} from './freeze-authority-v2.ts';

const CONTROL_PATHS = {
  preCandidateFreeze: 'benchmark/protocol/pre-candidate-freeze-v1.json',
  executableClosure: 'benchmark/protocol/freeze-executable-closure-v1.json',
  profile: 'benchmark/protocol/controlled-subject-profile-v1.json',
  mutationSpec: 'benchmark/protocol/controlled-mutation-spec-v1.json',
  buildContract: 'benchmark/protocol/controlled-build-contract-v1.json',
  acceptanceMatrix: 'benchmark/protocol/controlled-profile-acceptance-matrix-v1.json',
  sameCandidateProtocol: 'benchmark/protocol/single-case-v2.json',
  challengeSchema: 'benchmark/schemas/controlled-challenge-manifest-v1.schema.json',
  generationEvidenceSchema: 'benchmark/schemas/controlled-generation-evidence-v1.schema.json',
  generationEvidenceSchemaV2: 'benchmark/schemas/controlled-generation-evidence-v2.schema.json',
  profileSchema: 'benchmark/schemas/controlled-subject-profile-v1.schema.json',
  receiptSchema: 'benchmark/schemas/controlled-benchmark-subject-receipt-v1.schema.json',
  singleCaseResultSchema: 'benchmark/schemas/single-case-result-v1.schema.json',
  subjectAdapter: 'src/evaluation/p03-subject-adapter.cjs',
  subjectExecutor: 'src/evaluation/p03-subject.ts',
  generator: 'src/benchmark/controlled-candidate-generator.ts',
  generatorCli: 'scripts/cat-generate-controlled-candidate.ts',
  gateCli: 'scripts/cat-subject.ts',
} as const;

export const EXECUTABLE_ROOTS = ['scripts/cat-generate-controlled-candidate.ts', 'scripts/cat-subject.ts',
  'src/benchmark/controlled-candidate-generator.ts', 'src/evaluation/p03-subject.ts', 'src/evaluation/p03-subject-adapter.cjs'];
const CONTROL_ARTIFACT_PATHS = [CONTROL_PATHS.profile, CONTROL_PATHS.mutationSpec, CONTROL_PATHS.buildContract,
  CONTROL_PATHS.acceptanceMatrix, CONTROL_PATHS.sameCandidateProtocol, CONTROL_PATHS.challengeSchema,
  CONTROL_PATHS.generationEvidenceSchema, CONTROL_PATHS.profileSchema, CONTROL_PATHS.receiptSchema,
  CONTROL_PATHS.singleCaseResultSchema];

type InventoryRow = {path: string; sha256: string};
type FrozenControls = {freezeCommitSha: string; manifest: any; profile: any; spec: any; build: any; protocol: any; bytes: Record<string, Buffer>};
type BuildAdapter = (sourceRoot: string, dependencyRoot: string, contract: any) => Promise<Record<string, Buffer>> | Record<string, Buffer>;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const rowsHash = (rows: unknown) => digest(canonical(rows));
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

function checkedPath(root: string, relativePath: string) {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')) throw new Error('CONTROLLED_PATH_INVALID');
  const full = path.resolve(root, relativePath);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error('CONTROLLED_PATH_INVALID');
  rejectLinkedAncestors(root, full);
  return full;
}

function rejectLinkedAncestors(root: string, target: string) {
  const base = path.resolve(root), resolved = path.resolve(target);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('CONTROLLED_PATH_INVALID');
  if (lstatSync(base).isSymbolicLink()) throw new Error('CONTROLLED_SYMLINK_REJECTED');
  let current = base;
  for (const part of path.relative(base, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('CONTROLLED_SYMLINK_REJECTED'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

export function inventoryDependencyV1(rootPath: string): InventoryRow[] {
  const root = path.resolve(rootPath);
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('DEPENDENCY_ROOT_INVALID');
  const rows: InventoryRow[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, {withFileTypes: true})) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('DEPENDENCY_SYMLINK_REJECTED');
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) rows.push({path: path.relative(root, target).split(path.sep).join('/'), sha256: digest(readFileSync(target))});
      else throw new Error('DEPENDENCY_ENTRY_TYPE_REJECTED');
    }
  };
  walk(root);
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function inventorySourceV1(rootPath: string): InventoryRow[] {
  const root = path.resolve(rootPath);
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error('SOURCE_ROOT_INVALID');
  const rows: InventoryRow[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, {withFileTypes: true})) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('SOURCE_SYMLINK_REJECTED');
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) rows.push({path: path.relative(root, target).split(path.sep).join('/'), sha256: digest(readFileSync(target))});
      else throw new Error('SOURCE_ENTRY_TYPE_REJECTED');
    }
  };
  walk(root);
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function git(root: string, args: string[], encoding: BufferEncoding | 'buffer' = 'utf8'): any {
  return execFileSync(process.env.CAT_TRUSTED_GIT_PATH || 'git', ['-C', root, ...args], {encoding, stdio: ['ignore', 'pipe', 'pipe']});
}

function committedBlob(root: string, commitSha: string, filePath: string): Buffer {
  const treeEntry = String(git(root, ['ls-tree', commitSha, '--', filePath])).trim();
  const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(treeEntry);
  if (!match || match[3] !== filePath) throw new Error('FREEZE_CONTROL_BLOB_INVALID');
  const output = git(root, ['cat-file', 'blob', match[2]], 'buffer') as Buffer;
  return output;
}

function parseJson(bytes: Buffer, errorCode: string) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Error(errorCode); }
}

function exactKeys(value: any, keys: string[]) {
  return value && typeof value === 'object' && !Array.isArray(value) && canonical(Object.keys(value).sort()) === canonical([...keys].sort());
}

const EXECUTABLE_EXTENSIONS = ['.ts', '.js', '.cjs', '.mjs', '.json'];
const LOCAL_IMPORT = /(?:\b(?:import|export)\s+(?:[\s\S]*?\s+from\s*)?|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"]+)['"]/g;

export function inventoryExecutableClosure(repoRoot: string, entrypoints = EXECUTABLE_ROOTS): InventoryRow[] {
  const root = path.resolve(repoRoot), pending = [...entrypoints], seen = new Set<string>();
  while (pending.length) {
    const filePath = pending.pop()!.split(path.sep).join('/');
    if (seen.has(filePath)) continue;
    const fullPath = checkedPath(root, filePath);
    if (!existsSync(fullPath) || !lstatSync(fullPath).isFile() || !EXECUTABLE_EXTENSIONS.includes(path.extname(filePath))) throw new Error('FREEZE_CODE_CLOSURE_UNRESOLVED');
    seen.add(filePath);
    const source = readFileSync(fullPath, 'utf8');
    const specifiers = new Set<string>();
    for (const match of source.matchAll(LOCAL_IMPORT)) specifiers.add(match[1]);
    const dynamicCalls = [...source.matchAll(/\b(import|require)\s*\(([^)]*)\)/g)];
    const unresolvedCalls = dynamicCalls.filter(([, , argument]) => !/^\s*['"]/.test(argument));
    const boundedCandidateLoader = filePath === 'src/evaluation/p03-subject-adapter.cjs' && unresolvedCalls.length === 1 &&
      unresolvedCalls[0][1] === 'require' && unresolvedCalls[0][2].trim() === 'entrypoint';
    if (unresolvedCalls.length && !boundedCandidateLoader) throw new Error('FREEZE_CODE_CLOSURE_UNRESOLVED');
    // The adapter's sole dynamic require is constrained by the frozen candidate runtime manifest.
    for (const specifier of specifiers) {
      if (isBuiltin(specifier)) continue;
      if (!specifier.startsWith('.')) {
        if (specifier.startsWith('node:')) continue;
        throw new Error('FREEZE_CODE_CLOSURE_UNRESOLVED');
      }
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), specifier));
      if (base.startsWith('../') || base === '..') throw new Error('FREEZE_CODE_CLOSURE_UNRESOLVED');
      const candidates = path.posix.extname(base) ? [base] : [base, ...EXECUTABLE_EXTENSIONS.map((extension) => base + extension), ...EXECUTABLE_EXTENSIONS.map((extension) => `${base}/index${extension}`)];
      const found = candidates.find((candidate) => existsSync(checkedPath(root, candidate)) && lstatSync(checkedPath(root, candidate)).isFile());
      if (!found || found.split('/').includes('node_modules')) throw new Error('FREEZE_CODE_CLOSURE_UNRESOLVED');
      pending.push(found);
    }
  }
  return [...seen].sort().map((filePath) => ({path: filePath, sha256: digest(readFileSync(checkedPath(root, filePath)))}));
}

export function loadFrozenControlsV1(repoRoot: string, freezeCommitSha: string): FrozenControls {
  if (typeof freezeCommitSha !== 'string' || !COMMIT.test(freezeCommitSha)) throw new Error('FREEZE_COMMIT_SHA_REQUIRED');
  try { git(repoRoot, ['cat-file', '-e', `${freezeCommitSha}^{commit}`]); } catch { throw new Error('FREEZE_COMMIT_NOT_FOUND'); }
  const manifestBytes = committedBlob(repoRoot, freezeCommitSha, CONTROL_PATHS.preCandidateFreeze);
  const manifest = parseJson(manifestBytes, 'FREEZE_MANIFEST_INVALID');
  if (!exactKeys(manifest, ['manifestVersion', 'status', 'futureAnchor', 'artifacts', 'executableClosureVersion', 'executableClosureSha256', 'profileSha256', 'mutationSpecSha256', 'buildContractSha256', 'sameCandidateProtocolSha256', 'acceptanceMatrixSha256', 'dependencyIdentityVersion', 'dependencyIdentitySha256', 'dependencyLockSha256', 'executionInfrastructureIdentitySha256', 'generatorSourceIdentitySha256', 'controlledGateSourceIdentitySha256', 'sameCandidateContractSha256']) ||
      manifest.manifestVersion !== 'PreCandidateFreezeV1' || manifest.status !== 'READY_FOR_OWNER_FREEZE_COMMIT' ||
      manifest.futureAnchor !== 'freezeCommitSha' || !exactKeys(manifest.artifacts, [...CONTROL_ARTIFACT_PATHS, CONTROL_PATHS.executableClosure])) throw new Error('FREEZE_MANIFEST_INVALID');
  const bytes: Record<string, Buffer> = {[CONTROL_PATHS.preCandidateFreeze]: manifestBytes};
  for (const filePath of [...CONTROL_ARTIFACT_PATHS, CONTROL_PATHS.executableClosure]) {
    const expected = manifest.artifacts[filePath];
    if (typeof expected !== 'string' || !HASH.test(expected)) throw new Error('FREEZE_ARTIFACT_BINDING_INVALID');
    const actual = committedBlob(repoRoot, freezeCommitSha, filePath);
    if (digest(actual) !== expected) throw new Error('FREEZE_ARTIFACT_HASH_MISMATCH');
    const workingPath = checkedPath(repoRoot, filePath);
    rejectLinkedAncestors(repoRoot, workingPath);
    if (!existsSync(workingPath) || digest(readFileSync(workingPath)) !== expected) throw new Error('FREEZE_WORKTREE_ARTIFACT_MISMATCH');
    bytes[filePath] = actual;
  }
  const closureDocument = parseJson(bytes[CONTROL_PATHS.executableClosure], 'FREEZE_EXECUTABLE_CLOSURE_INVALID');
  if (!exactKeys(closureDocument, ['version', 'rows']) || closureDocument.version !== 'FreezeExecutableClosureV1' || !Array.isArray(closureDocument.rows) ||
      closureDocument.rows.some((row: any, index: number) => !row || !exactKeys(row, ['path', 'sha256']) || typeof row.path !== 'string' || !HASH.test(row.sha256) ||
        (index > 0 && closureDocument.rows[index - 1].path >= row.path)) || rowsHash(closureDocument.rows) !== manifest.executableClosureSha256 ||
      manifest.executableClosureVersion !== closureDocument.version) throw new Error('FREEZE_EXECUTABLE_CLOSURE_INVALID');
  const closurePaths = new Set(closureDocument.rows.map((row: InventoryRow) => row.path));
  if (EXECUTABLE_ROOTS.some((entry) => !closurePaths.has(entry))) throw new Error('FREEZE_EXECUTABLE_CLOSURE_INVALID');
  for (const row of closureDocument.rows as InventoryRow[]) {
    const actual = committedBlob(repoRoot, freezeCommitSha, row.path);
    if (digest(actual) !== row.sha256) throw new Error('FREEZE_EXECUTABLE_CLOSURE_COMMIT_MISMATCH');
    const workingPath = checkedPath(repoRoot, row.path);
    if (!existsSync(workingPath) || !lstatSync(workingPath).isFile() || digest(readFileSync(workingPath)) !== row.sha256) throw new Error('FREEZE_EXECUTABLE_CLOSURE_WORKTREE_MISMATCH');
    bytes[row.path] = actual;
  }
  if (canonical(inventoryExecutableClosure(repoRoot)) !== canonical(closureDocument.rows)) throw new Error('FREEZE_EXECUTABLE_CLOSURE_GRAPH_MISMATCH');
  const profile = parseJson(bytes[CONTROL_PATHS.profile], 'FREEZE_PROFILE_INVALID');
  const spec = parseJson(bytes[CONTROL_PATHS.mutationSpec], 'FREEZE_SPEC_INVALID');
  const build = parseJson(bytes[CONTROL_PATHS.buildContract], 'FREEZE_BUILD_CONTRACT_INVALID');
  const protocol = parseJson(bytes[CONTROL_PATHS.sameCandidateProtocol], 'FREEZE_SAME_CANDIDATE_PROTOCOL_INVALID');
  const matrix = parseJson(bytes[CONTROL_PATHS.acceptanceMatrix], 'FREEZE_ACCEPTANCE_MATRIX_INVALID');
  const matrixIds = matrix.controlledProfileRequirements?.map((row: any) => row.id).sort();
  const infra = profile.controlledExecutionInfrastructureV2;
  const infraProjection = {...infra}; delete infraProjection.identitySha256;
  const generatorIdentity = rowsHash(closureDocument.rows);
  const gateIdentity = generatorIdentity;
  if (profile.status !== 'READY_FOR_OWNER_FREEZE_REVIEW' || profile.candidateCreated !== false || profile.competitiveLanesExecuted !== false ||
      profile.maliciousCodeIsolationClaim !== false || profile.arbitraryExternalSubjectSupport !== 'NOT_APPROVED' ||
      spec.behavioralClass !== 'TTL_ZERO_DELETES_EXISTING_ENTRY' || spec.alternatives?.length !== 0 || spec.fallbacks?.length !== 0 ||
      spec.transform?.oldText !== 'if ttl >= 0' || spec.transform?.newText !== 'if ttl > 0' || spec.transform?.matchCount !== 1 ||
      build.contractVersion !== 'ControlledBuildContractV1' || protocol.protocolVersion !== 'SingleCaseProtocolV2' ||
      infra?.identityVersion !== 'ExecutionInfrastructureIdentityV2' || infra.identitySha256 !== rowsHash(infraProjection) ||
      infra.subjectAdapterPath !== CONTROL_PATHS.subjectAdapter || infra.executorPath !== CONTROL_PATHS.subjectExecutor ||
      infra.subjectAdapterSha256 !== digest(bytes[CONTROL_PATHS.subjectAdapter]) || infra.executorSha256 !== digest(bytes[CONTROL_PATHS.subjectExecutor]) ||
      !Array.isArray(matrixIds) || canonical(matrixIds) !== canonical([...profile.controlledProfileRequirements].sort())) {
    throw new Error('FREEZE_CONTROL_INVARIANT_FAILED');
  }
  if (manifest.profileSha256 !== manifest.artifacts[CONTROL_PATHS.profile] ||
      manifest.mutationSpecSha256 !== manifest.artifacts[CONTROL_PATHS.mutationSpec] ||
      manifest.buildContractSha256 !== manifest.artifacts[CONTROL_PATHS.buildContract] ||
      manifest.sameCandidateProtocolSha256 !== manifest.artifacts[CONTROL_PATHS.sameCandidateProtocol] ||
      manifest.acceptanceMatrixSha256 !== manifest.artifacts[CONTROL_PATHS.acceptanceMatrix] ||
      profile.acceptanceMatrixSha256 !== manifest.artifacts[CONTROL_PATHS.acceptanceMatrix] ||
      manifest.dependencyIdentityVersion !== 'DependencyInventoryV1' ||
      manifest.dependencyIdentitySha256 !== profile.dependencyIdentity.inventorySha256 ||
      manifest.dependencyLockSha256 !== build.dependency.lockfileSha256 ||
      manifest.executionInfrastructureIdentitySha256 !== profile.controlledExecutionInfrastructureV2?.identitySha256 ||
      profile.controlledExecutionInfrastructureV2?.buildContractSha256 !== manifest.buildContractSha256 ||
      manifest.generatorSourceIdentitySha256 !== generatorIdentity || manifest.controlledGateSourceIdentitySha256 !== gateIdentity ||
      manifest.sameCandidateContractSha256 !== manifest.artifacts[CONTROL_PATHS.sameCandidateProtocol] ||
      Object.keys(manifest.artifacts).some((filePath) => digest(committedBlob(repoRoot, freezeCommitSha, filePath)) !== manifest.artifacts[filePath]) ||
      build.runtime.nodeVersion !== profile.controlledExecutionInfrastructureV2?.nodeRuntimeVersion ||
      build.runtime.containerImageDigest !== profile.controlledExecutionInfrastructureV2?.containerImageDigest) throw new Error('FREEZE_MANIFEST_BINDING_INVALID');
  return {freezeCommitSha, manifest, profile, spec, build, protocol, bytes};
}

// Historical V1 reader retained for audit-only tests; production paths use V2 below.
export const loadFrozenControls = loadFrozenControlsV1;

function copyTree(source: string, destination: string) {
  mkdirSync(destination, {recursive: true});
  for (const entry of readdirSync(source, {withFileTypes: true})) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error('SOURCE_SYMLINK_REJECTED');
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
    else throw new Error('SOURCE_ENTRY_TYPE_REJECTED');
  }
}

export function normalizeBuildBanner(bytes: Buffer, filePath: string, contract: any): Buffer {
  const policy = contract.bannerNormalization;
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const pattern = new RegExp(`(${escapeRegExp(policy.prefix)})(${policy.datePattern})(${escapeRegExp(policy.suffix)})`, 'g');
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== policy.expectedMatchCounts[filePath] || matches.length !== 1) throw new Error('BUILD_BANNER_MATCH_COUNT_INVALID');
  const normalized = text.replace(pattern, `$1${policy.frozenDate}$3`);
  return Buffer.from(normalized, 'utf8');
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function dockerPath(value: string) { return path.resolve(value).replaceAll('\\', '/'); }

export function runFrozenDockerBuild(sourceRoot: string, dependencyRoot: string, contract: any): Record<string, Buffer> {
  const image = `node@${contract.runtime.containerImageDigest}`;
  const runtimeVersion = String(execFileSync('docker', ['run', '--rm', '--pull=never', '--network=none', '--entrypoint', 'node', image, '--version'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})).trim();
  if (runtimeVersion !== contract.runtime.nodeVersion) throw new Error('BUILD_NODE_VERSION_MISMATCH');
  const work = dockerPath(sourceRoot), deps = dockerPath(dependencyRoot);
  const execution = contract.execution;
  const args = [
    'run', '--rm', '--pull=never', `--network=${execution.network}`, '--read-only', '--pids-limit', String(execution.pidsLimit),
    '--memory', execution.memoryLimit, '--cpus', String(execution.cpuLimit), '--user', execution.containerUser,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', execution.temporaryFilesystem,
    '--mount', `type=bind,source=${work},target=/work`, '--mount', `type=bind,source=${deps},target=/work/node_modules,readonly`,
    '--workdir', '/work', image, ...contract.command,
  ];
  execFileSync('docker', args, {stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000});
  const allRows = inventorySourceV1(sourceRoot);
  const generated = allRows.filter((row) => row.path.endsWith('.js')).map((row) => row.path).sort();
  if (canonical(generated) !== canonical(contract.expectedRuntimeFiles)) throw new Error('BUILD_RUNTIME_FILE_SET_INVALID');
  const output: Record<string, Buffer> = {};
  for (const filePath of contract.expectedRuntimeFiles) {
    output[filePath] = normalizeBuildBanner(readFileSync(checkedPath(sourceRoot, filePath)), filePath, contract);
  }
  return output;
}

function runtimeRows(output: Record<string, Buffer>, expectedFiles: string[]): InventoryRow[] {
  if (canonical(Object.keys(output).sort()) !== canonical([...expectedFiles].sort())) throw new Error('BUILD_RUNTIME_FILE_SET_INVALID');
  return Object.keys(output).sort().map((filePath) => ({path: filePath, sha256: digest(output[filePath])}));
}

async function buildTwice(sourceRoot: string, dependencyRoot: string, contract: any, adapter?: BuildAdapter) {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'cat-controlled-build-'));
  try {
    const outputs = [];
    for (let index = 1; index <= 2; index++) {
      const work = path.join(temp, `build-${index}`);
      copyTree(sourceRoot, work);
      const raw = adapter ? await adapter(work, dependencyRoot, contract) : runFrozenDockerBuild(work, dependencyRoot, contract);
      const output = adapter ? Object.fromEntries(contract.expectedRuntimeFiles.map((filePath: string) => [filePath,
        normalizeBuildBanner(raw[filePath], filePath, contract)])) : raw;
      outputs.push(output);
    }
    const firstRows = runtimeRows(outputs[0], contract.expectedRuntimeFiles);
    const secondRows = runtimeRows(outputs[1], contract.expectedRuntimeFiles);
    if (canonical(firstRows) !== canonical(secondRows) || !contract.expectedRuntimeFiles.every((filePath: string) => outputs[0][filePath].equals(outputs[1][filePath]))) {
      throw new Error('CONTROLLED_BUILD_NOT_REPRODUCIBLE');
    }
    return {runtime: outputs[0], rows: firstRows, runtimeCandidateHash: rowsHash(firstRows),
      reproductionRows: secondRows, reproductionRuntimeCandidateHash: rowsHash(secondRows)};
  } finally { rmSync(temp, {recursive: true, force: true}); }
}

export async function reproduceBuildTwice(sourceRoot: string, dependencyRoot: string, contract: any, adapter?: BuildAdapter) {
  return buildTwice(sourceRoot, dependencyRoot, contract, adapter);
}

function assertDependencyIdentity(controls: FrozenControls, repoRoot: string) {
  const dep = controls.profile.dependencyIdentity, buildDep = controls.build.dependency;
  const dependencyRoot = checkedPath(repoRoot, dep.root);
  const rows = inventoryDependencyV1(dependencyRoot);
  const identitySha256 = rowsHash(rows);
  const lockSha256 = digest(readFileSync(checkedPath(repoRoot, buildDep.lockfilePath)));
  const toolHashes = [buildDep.gruntCliPath, buildDep.gruntEntrypointPath, buildDep.coffeeScriptCompilerPath].map((_part: string, index: number) => {
    const paths = [path.join(dependencyRoot, 'grunt-cli/bin/grunt'), path.join(dependencyRoot, 'grunt/lib/grunt.js'), path.join(dependencyRoot, 'coffee-script/lib/coffee-script/coffee-script.js')];
    return digest(readFileSync(paths[index]));
  });
  if (rows.length !== dep.fileCount || identitySha256 !== dep.inventorySha256 || identitySha256 !== buildDep.identitySha256 ||
      lockSha256 !== dep.lockfileSha256 || lockSha256 !== buildDep.lockfileSha256 ||
      canonical(toolHashes) !== canonical([buildDep.gruntCliSha256, buildDep.gruntEntrypointSha256, buildDep.coffeeScriptCompilerSha256])) {
    throw new Error('DEPENDENCY_IDENTITY_MISMATCH');
  }
  return {dependencyRoot, identitySha256, lockSha256, count: rows.length};
}

function verifyBaseTree(controls: FrozenControls, repoRoot: string) {
  const baseRoot = checkedPath(repoRoot, controls.profile.base.sourceRoot);
  const rows = inventorySourceV1(baseRoot);
  if (rows.length !== controls.profile.base.sourceTreeFileCount || rowsHash(rows) !== controls.profile.base.sourceTreeSha256 ||
      canonical(rows) !== canonical(controls.profile.base.sourceTree)) throw new Error('CONTROLLED_BASE_TREE_MISMATCH');
  const sourcePath = checkedPath(baseRoot, controls.spec.sourcePath);
  const sourceBytes = readFileSync(sourcePath);
  const oldText = Buffer.from(controls.spec.transform.oldText, 'utf8');
  if (digest(sourceBytes) !== controls.spec.baseFileSha256 || oldText.length === 0 || sourceBytes.toString('utf8').split(oldText.toString('utf8')).length - 1 !== 1) {
    throw new Error('CONTROLLED_MUTATION_PREIMAGE_INVALID');
  }
  return baseRoot;
}

function verifyExactDelta(baseRoot: string, candidateRoot: string, spec: any) {
  const baseRows = inventorySourceV1(baseRoot), candidateRows = inventorySourceV1(candidateRoot);
  const base = new Map(baseRows.map((row) => [row.path, row.sha256]));
  const candidate = new Map(candidateRows.map((row) => [row.path, row.sha256]));
  const changed = [...new Set([...base.keys(), ...candidate.keys()])].filter((file) => base.get(file) !== candidate.get(file)).sort();
  const original = readFileSync(checkedPath(baseRoot, spec.sourcePath));
  const replacement = Buffer.from(original.toString('utf8').replace(spec.transform.oldText, spec.transform.newText), 'utf8');
  const actual = readFileSync(checkedPath(candidateRoot, spec.sourcePath));
  if (canonical(changed) !== canonical([spec.sourcePath]) || baseRows.length !== candidateRows.length || !actual.equals(replacement) || actual.equals(original)) {
    throw new Error('CONTROLLED_SOURCE_DELTA_INVALID');
  }
  const sourceCandidateHash = rowsHash(candidateRows);
  return {rows: candidateRows, sourceCandidateHash, changeBindings: [{path: spec.sourcePath, baseSha256: base.get(spec.sourcePath), resultSha256: candidate.get(spec.sourcePath)}]};
}

function derivationIdentity(derivation: any) {
  return rowsHash({sourceRows: derivation.source.rows, sourceCandidateHash: derivation.source.sourceCandidateHash,
    changeBindings: derivation.source.changeBindings, runtimeRows: derivation.runtimeRows, runtimeCandidateHash: derivation.runtimeCandidateHash});
}

function byteTreesEqual(leftRoot: string, rightRoot: string, leftRows: InventoryRow[], rightRows: InventoryRow[]) {
  return canonical(leftRows) === canonical(rightRows) && leftRows.every((row) =>
    readFileSync(checkedPath(leftRoot, row.path)).equals(readFileSync(checkedPath(rightRoot, row.path))));
}

function verifyBundleLayout(bundle: string) {
  const expected = ['challenge-manifest.json', 'generation-evidence.json', 'manifest.json', 'reproduction', 'runtime', 'source'];
  const actual = readdirSync(bundle, {withFileTypes: true});
  if (canonical(actual.map((entry) => entry.name).sort()) !== canonical(expected) || actual.some((entry) => entry.isSymbolicLink())) throw new Error('CONTROLLED_BUNDLE_LAYOUT_INVALID');
  const reproduction = readdirSync(path.join(bundle, 'reproduction'), {withFileTypes: true});
  if (canonical(reproduction.map((entry) => entry.name).sort()) !== canonical(['runtime', 'source']) || reproduction.some((entry) => entry.isSymbolicLink())) {
    throw new Error('CONTROLLED_BUNDLE_LAYOUT_INVALID');
  }
}

async function deriveCandidateOnce(baseRoot: string, dependencyRoot: string, controls: FrozenControls, derivationRoot: string, adapter?: BuildAdapter) {
  const baseRows = inventorySourceV1(baseRoot);
  if (baseRows.length !== controls.profile.base.sourceTreeFileCount || rowsHash(baseRows) !== controls.profile.base.sourceTreeSha256 ||
      canonical(baseRows) !== canonical(controls.profile.base.sourceTree)) throw new Error('CONTROLLED_BASE_TREE_MISMATCH');
  mkdirSync(derivationRoot, {recursive: false});
  const sourceRoot = path.join(derivationRoot, 'source');
  copyTree(baseRoot, sourceRoot);
  const sourceFile = checkedPath(sourceRoot, controls.spec.sourcePath);
  const before = readFileSync(sourceFile), oldText = controls.spec.transform.oldText, newText = controls.spec.transform.newText;
  if (before.toString('utf8').split(oldText).length - 1 !== controls.spec.transform.matchCount) throw new Error('CONTROLLED_MUTATION_MATCH_COUNT_INVALID');
  writeFileSync(sourceFile, Buffer.from(before.toString('utf8').replace(oldText, newText), 'utf8'));
  const source = verifyExactDelta(baseRoot, sourceRoot, controls.spec);
  const built = await buildTwice(sourceRoot, dependencyRoot, controls.build, adapter);
  return {sourceRoot, source, runtime: built.runtime, runtimeRows: built.rows, runtimeCandidateHash: built.runtimeCandidateHash};
}

export function noExistingOutput(repoRoot: string, candidateBundleRoot: string, outputDirectory: string) {
  const root = path.resolve(repoRoot), target = path.resolve(root, outputDirectory);
  if (path.resolve(root, candidateBundleRoot) !== target || existsSync(target) || !target.startsWith(root + path.sep)) throw new Error('CONTROLLED_OUTPUT_PATH_REJECTED');
  checkedPath(root, candidateBundleRoot);
  return target;
}

export function preflightControlledCandidate(options: {repoRoot: string; freezeCommitSha: string; outputDirectory?: string}) {
  const repoRoot = path.resolve(options.repoRoot);
  const controls = loadFrozenControlsV2(repoRoot, options.freezeCommitSha);
  const outputRoot = noExistingOutput(repoRoot, controls.profile.candidateBundleRoot, options.outputDirectory ?? controls.profile.candidateBundleRoot);
  const dependency = assertDependencyIdentity(controls, repoRoot);
  verifyBaseTree(controls, repoRoot);
  return {controls, outputRoot, dependency};
}

export async function generateControlledCandidate(options: {repoRoot: string; freezeCommitSha: string; outputDirectory: string; buildAdapter?: BuildAdapter}) {
  const repoRoot = path.resolve(options.repoRoot);
  const controls = loadFrozenControlsV2(repoRoot, options.freezeCommitSha);
  const outputRoot = noExistingOutput(repoRoot, controls.profile.candidateBundleRoot, options.outputDirectory);
  const dependency = assertDependencyIdentity(controls, repoRoot);
  const baseRoot = verifyBaseTree(controls, repoRoot);
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'cat-controlled-generator-'));
  let staged: string | undefined;
  try {
    mkdirSync(path.dirname(outputRoot), {recursive: true});
    staged = mkdtempSync(`${outputRoot}.staging-`);
    const primary = await deriveCandidateOnce(baseRoot, dependency.dependencyRoot, controls, path.join(temporary, 'derivation-primary'), options.buildAdapter);
    const reproduction = await deriveCandidateOnce(baseRoot, dependency.dependencyRoot, controls, path.join(temporary, 'derivation-reproduction'), options.buildAdapter);
    if (!byteTreesEqual(primary.sourceRoot, reproduction.sourceRoot, primary.source.rows, reproduction.source.rows) ||
        primary.source.sourceCandidateHash !== reproduction.source.sourceCandidateHash ||
        canonical(primary.source.changeBindings) !== canonical(reproduction.source.changeBindings)) throw new Error('CONTROLLED_SOURCE_GENERATION_NOT_REPRODUCIBLE');
    if (canonical(primary.runtimeRows) !== canonical(reproduction.runtimeRows) || primary.runtimeCandidateHash !== reproduction.runtimeCandidateHash ||
        !controls.build.expectedRuntimeFiles.every((filePath: string) => primary.runtime[filePath].equals(reproduction.runtime[filePath]))) {
      throw new Error('CONTROLLED_RUNTIME_GENERATION_NOT_REPRODUCIBLE');
    }
    primary.derivationIdentitySha256 = derivationIdentity(primary);
    reproduction.derivationIdentitySha256 = derivationIdentity(reproduction);
    if (primary.derivationIdentitySha256 !== reproduction.derivationIdentitySha256) throw new Error('CONTROLLED_FULL_GENERATION_NOT_REPRODUCIBLE');
    const source = primary.source, built = {rows: primary.runtimeRows, runtimeCandidateHash: primary.runtimeCandidateHash, runtime: primary.runtime};
    const p03Manifest = {version: 1, caseId: controls.profile.caseId, candidateId: controls.profile.candidateId,
      candidateRoot: controls.profile.candidateRoot, entrypoint: 'index.js', files: built.rows, candidateHash: built.runtimeCandidateHash};
    const p03ManifestSha256 = digest(canonical(p03Manifest));
    const infraSha256 = controls.manifest.executionInfrastructureIdentitySha256;
    const evidenceDerivation = (item: any) => ({sourceRows: item.source.rows, sourceCandidateHash: item.source.sourceCandidateHash,
      changeBindings: item.source.changeBindings, runtimeRows: item.runtimeRows, runtimeCandidateHash: item.runtimeCandidateHash,
      derivationIdentitySha256: item.derivationIdentitySha256});
    const generationEvidence: any = {evidenceVersion: 'ControlledGenerationEvidenceV2', sourceIdentityAlgorithm: 'SourceInventoryV1',
      runtimeIdentityAlgorithm: 'RuntimeInventoryV1', freezeCommitSha: controls.freezeCommitSha,
      profileSha256: controls.manifest.artifacts[CONTROL_PATHS.profile], mutationSpecSha256: controls.manifest.artifacts[CONTROL_PATHS.mutationSpec],
      buildContractSha256: controls.manifest.artifacts[CONTROL_PATHS.buildContract], sourceCandidateHash: source.sourceCandidateHash,
      runtimeCandidateHash: built.runtimeCandidateHash, runtimeManifestSha256: p03ManifestSha256,
      dependencyIdentitySha256: dependency.identitySha256, dependencyLockSha256: dependency.lockSha256,
      executionInfrastructureIdentitySha256: infraSha256, changedPaths: [controls.spec.sourcePath], changeBindings: source.changeBindings,
      reproducibility: {version: 'ControlledGenerationReproducibilityV1', derivationCount: 2,
        primary: evidenceDerivation(primary), reproduction: evidenceDerivation(reproduction), sourceByteEquivalent: true,
        runtimeByteEquivalent: true, changeBindingEquivalent: true, fullGenerationEquivalent: true}};
    const generationEvidenceSha256 = digest(canonical(generationEvidence));
    const challengeManifest = {manifestVersion: 'ControlledChallengeManifestV1', challengeId: controls.protocol.challengeId,
      freezeCommitSha: controls.freezeCommitSha, profileSha256: generationEvidence.profileSha256, mutationSpecSha256: generationEvidence.mutationSpecSha256,
      buildContractSha256: generationEvidence.buildContractSha256, baseSourceTreeSha256: controls.profile.base.sourceTreeSha256,
      sourceCandidateHash: source.sourceCandidateHash, runtimeCandidateHash: built.runtimeCandidateHash, generationEvidenceSha256,
      dependencyIdentitySha256: dependency.identitySha256, executionInfrastructureIdentitySha256: infraSha256, changedPaths: [controls.spec.sourcePath]};
    mkdirSync(path.join(staged, 'source'), {recursive: true});
    mkdirSync(path.join(staged, 'runtime'), {recursive: true});
    mkdirSync(path.join(staged, 'reproduction/source'), {recursive: true});
    mkdirSync(path.join(staged, 'reproduction/runtime'), {recursive: true});
    copyTree(primary.sourceRoot, path.join(staged, 'source'));
    copyTree(reproduction.sourceRoot, path.join(staged, 'reproduction/source'));
    for (const filePath of controls.build.expectedRuntimeFiles) {
      const destination = checkedPath(path.join(staged, 'runtime'), filePath);
      mkdirSync(path.dirname(destination), {recursive: true});
      writeFileSync(destination, built.runtime[filePath], {flag: 'wx'});
      const reproductionDestination = checkedPath(path.join(staged, 'reproduction/runtime'), filePath);
      mkdirSync(path.dirname(reproductionDestination), {recursive: true});
      writeFileSync(reproductionDestination, reproduction.runtime[filePath], {flag: 'wx'});
    }
    writeFileSync(path.join(staged, 'manifest.json'), JSON.stringify(p03Manifest, null, 2) + '\n', {flag: 'wx'});
    writeFileSync(path.join(staged, 'generation-evidence.json'), JSON.stringify({...generationEvidence, generationEvidenceSha256}, null, 2) + '\n', {flag: 'wx'});
    writeFileSync(path.join(staged, 'challenge-manifest.json'), JSON.stringify(challengeManifest, null, 2) + '\n', {flag: 'wx'});
    try {
      const {rename} = await import('node:fs/promises');
      for (let attempt = 0; ; attempt++) {
        try { await rename(staged, outputRoot); break; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt === 4) throw error;
          await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        }
      }
    }
    catch (error) { rmSync(staged, {recursive: true, force: true}); throw error; }
    return {sourceCandidateHash: source.sourceCandidateHash, runtimeCandidateHash: built.runtimeCandidateHash,
      generationEvidenceSha256, challengeManifest, p03Manifest, reproducibility: generationEvidence.reproducibility};
  } finally { rmSync(temporary, {recursive: true, force: true}); if (staged) rmSync(staged, {recursive: true, force: true}); }
}

export async function verifyControlledCandidate(options: {repoRoot: string; freezeCommitSha: string; sourceRoot: string; runtimeRoot: string; manifestPath: string; generationEvidencePath: string; challengeManifestPath: string; buildAdapter?: BuildAdapter}) {
  const repoRoot = path.resolve(options.repoRoot);
  const controls = loadFrozenControlsV2(repoRoot, options.freezeCommitSha);
  const bundle = path.resolve(repoRoot, controls.profile.candidateBundleRoot);
  const expectedPaths = {
    source: path.resolve(repoRoot, controls.profile.candidateSourceRoot),
    runtime: path.resolve(repoRoot, controls.profile.candidateRoot),
    reproductionSource: path.resolve(repoRoot, controls.profile.reproductionSourceRoot),
    reproductionRuntime: path.resolve(repoRoot, controls.profile.reproductionRuntimeRoot),
    manifest: path.join(bundle, 'manifest.json'),
    evidence: path.join(bundle, 'generation-evidence.json'),
    challenge: path.join(bundle, 'challenge-manifest.json'),
  };
  const suppliedPaths = {source: path.resolve(options.sourceRoot), runtime: path.resolve(options.runtimeRoot), manifest: path.resolve(options.manifestPath),
    evidence: path.resolve(options.generationEvidencePath), challenge: path.resolve(options.challengeManifestPath)};
  const suppliedExpectedPaths = {source: expectedPaths.source, runtime: expectedPaths.runtime, manifest: expectedPaths.manifest,
    evidence: expectedPaths.evidence, challenge: expectedPaths.challenge};
  if (canonical(suppliedPaths) !== canonical(suppliedExpectedPaths)) throw new Error('CONTROLLED_PATH_INVALID');
  for (const target of Object.values(expectedPaths)) rejectLinkedAncestors(repoRoot, target);
  verifyBundleLayout(bundle);
  const dependency = assertDependencyIdentity(controls, repoRoot);
  const baseRoot = verifyBaseTree(controls, repoRoot);
  const sourceRoot = path.resolve(options.sourceRoot), runtimeRoot = path.resolve(options.runtimeRoot);
  const reproductionSourceRoot = expectedPaths.reproductionSource, reproductionRuntimeRoot = expectedPaths.reproductionRuntime;
  const source = verifyExactDelta(baseRoot, sourceRoot, controls.spec);
  const reproductionSource = verifyExactDelta(baseRoot, reproductionSourceRoot, controls.spec);
  const suppliedRuntimeRows = inventorySourceV1(runtimeRoot), reproductionRuntimeRows = inventorySourceV1(reproductionRuntimeRoot);
  if (canonical(suppliedRuntimeRows.map((row) => row.path)) !== canonical(controls.build.expectedRuntimeFiles) ||
      canonical(reproductionRuntimeRows.map((row) => row.path)) !== canonical(controls.build.expectedRuntimeFiles)) throw new Error('CONTROLLED_RUNTIME_FILE_SET_INVALID');
  const manifest = parseJson(readFileSync(options.manifestPath), 'CONTROLLED_MANIFEST_INVALID');
  const evidence = parseJson(readFileSync(options.generationEvidencePath), 'CONTROLLED_GENERATION_EVIDENCE_INVALID');
  const challenge = parseJson(readFileSync(options.challengeManifestPath), 'CONTROLLED_CHALLENGE_MANIFEST_INVALID');
  const evidenceSha256 = evidence.generationEvidenceSha256;
  const evidenceProjection = {...evidence}; delete evidenceProjection.generationEvidenceSha256;
  const profileSha = controls.manifest.artifacts[CONTROL_PATHS.profile], specSha = controls.manifest.artifacts[CONTROL_PATHS.mutationSpec];
  const contractSha = controls.manifest.artifacts[CONTROL_PATHS.buildContract];
  const repro = evidence.reproducibility, primaryEvidence = repro?.primary, reproductionEvidence = repro?.reproduction;
  const derivationKeys = ['sourceRows', 'sourceCandidateHash', 'changeBindings', 'runtimeRows', 'runtimeCandidateHash', 'derivationIdentitySha256'];
  const validDerivation = (item: any, sourceResult: any, runtimeRowsValue: InventoryRow[]) => exactKeys(item, derivationKeys) &&
    canonical(item.sourceRows) === canonical(sourceResult.rows) && item.sourceCandidateHash === sourceResult.sourceCandidateHash &&
    canonical(item.changeBindings) === canonical(sourceResult.changeBindings) && canonical(item.runtimeRows) === canonical(runtimeRowsValue) &&
    item.runtimeCandidateHash === rowsHash(runtimeRowsValue) && item.derivationIdentitySha256 === rowsHash({sourceRows: item.sourceRows,
      sourceCandidateHash: item.sourceCandidateHash, changeBindings: item.changeBindings, runtimeRows: item.runtimeRows,
      runtimeCandidateHash: item.runtimeCandidateHash});
  const sourceBytesEquivalent = byteTreesEqual(sourceRoot, reproductionSourceRoot, source.rows, reproductionSource.rows);
  const runtimeBytesEquivalent = byteTreesEqual(runtimeRoot, reproductionRuntimeRoot, suppliedRuntimeRows, reproductionRuntimeRows);
  const bindingEquivalent = canonical(source.changeBindings) === canonical(reproductionSource.changeBindings);
  const fullGenerationEquivalent = validDerivation(primaryEvidence, source, suppliedRuntimeRows) &&
    validDerivation(reproductionEvidence, reproductionSource, reproductionRuntimeRows) &&
    primaryEvidence.derivationIdentitySha256 === reproductionEvidence.derivationIdentitySha256;
  if (!exactKeys(evidence, ['evidenceVersion', 'sourceIdentityAlgorithm', 'runtimeIdentityAlgorithm', 'freezeCommitSha', 'profileSha256', 'mutationSpecSha256', 'buildContractSha256', 'sourceCandidateHash', 'runtimeCandidateHash', 'runtimeManifestSha256', 'dependencyIdentitySha256', 'dependencyLockSha256', 'executionInfrastructureIdentitySha256', 'changedPaths', 'changeBindings', 'reproducibility', 'generationEvidenceSha256']) ||
      evidence.evidenceVersion !== 'ControlledGenerationEvidenceV2' || evidence.sourceIdentityAlgorithm !== 'SourceInventoryV1' || evidence.runtimeIdentityAlgorithm !== 'RuntimeInventoryV1' || evidenceSha256 !== digest(canonical(evidenceProjection)) ||
      !exactKeys(repro, ['version', 'derivationCount', 'primary', 'reproduction', 'sourceByteEquivalent', 'runtimeByteEquivalent', 'changeBindingEquivalent', 'fullGenerationEquivalent']) ||
      repro.version !== 'ControlledGenerationReproducibilityV1' || repro.derivationCount !== 2 || !sourceBytesEquivalent || !runtimeBytesEquivalent ||
      !bindingEquivalent || !fullGenerationEquivalent || repro.sourceByteEquivalent !== sourceBytesEquivalent ||
      repro.runtimeByteEquivalent !== runtimeBytesEquivalent || repro.changeBindingEquivalent !== bindingEquivalent ||
      repro.fullGenerationEquivalent !== fullGenerationEquivalent ||
      evidence.freezeCommitSha !== controls.freezeCommitSha || evidence.profileSha256 !== profileSha || evidence.mutationSpecSha256 !== specSha ||
      evidence.buildContractSha256 !== contractSha || evidence.sourceCandidateHash !== source.sourceCandidateHash || evidence.runtimeCandidateHash !== rowsHash(suppliedRuntimeRows) ||
      evidence.dependencyIdentitySha256 !== dependency.identitySha256 || evidence.dependencyLockSha256 !== dependency.lockSha256 ||
      evidence.executionInfrastructureIdentitySha256 !== controls.manifest.executionInfrastructureIdentitySha256 ||
      canonical(evidence.changeBindings) !== canonical(source.changeBindings) || canonical(evidence.changedPaths) !== canonical([controls.spec.sourcePath]) ||
      !exactKeys(manifest, ['version', 'caseId', 'candidateId', 'candidateRoot', 'entrypoint', 'files', 'candidateHash']) ||
      manifest.version !== 1 || manifest.caseId !== controls.profile.caseId || manifest.candidateId !== controls.profile.candidateId || manifest.entrypoint !== 'index.js' ||
      manifest.candidateRoot !== controls.profile.candidateRoot || canonical(manifest.files) !== canonical(suppliedRuntimeRows) ||
      manifest.candidateHash !== rowsHash(suppliedRuntimeRows) || evidence.runtimeManifestSha256 !== digest(canonical(manifest)) ||
      !exactKeys(challenge, ['manifestVersion', 'challengeId', 'freezeCommitSha', 'profileSha256', 'mutationSpecSha256', 'buildContractSha256', 'baseSourceTreeSha256', 'sourceCandidateHash', 'runtimeCandidateHash', 'generationEvidenceSha256', 'dependencyIdentitySha256', 'executionInfrastructureIdentitySha256', 'changedPaths']) ||
      challenge.manifestVersion !== 'ControlledChallengeManifestV1' || challenge.challengeId !== controls.protocol.challengeId ||
      challenge.freezeCommitSha !== controls.freezeCommitSha || challenge.profileSha256 !== profileSha || challenge.mutationSpecSha256 !== specSha ||
      challenge.buildContractSha256 !== contractSha || challenge.baseSourceTreeSha256 !== controls.profile.base.sourceTreeSha256 ||
      challenge.sourceCandidateHash !== source.sourceCandidateHash || challenge.runtimeCandidateHash !== rowsHash(suppliedRuntimeRows) ||
      challenge.generationEvidenceSha256 !== evidenceSha256 || challenge.dependencyIdentitySha256 !== dependency.identitySha256 ||
      challenge.executionInfrastructureIdentitySha256 !== controls.manifest.executionInfrastructureIdentitySha256 ||
      canonical(challenge.changedPaths) !== canonical([controls.spec.sourcePath])) throw new Error('CONTROLLED_GENERATION_BINDING_INVALID');
  const temp = mkdtempSync(path.join(os.tmpdir(), 'cat-independent-gate-'));
  try {
    const primaryBuildSource = path.join(temp, 'primary-source'), reproductionBuildSource = path.join(temp, 'reproduction-source');
    copyTree(sourceRoot, primaryBuildSource); copyTree(reproductionSourceRoot, reproductionBuildSource);
    const rebuilt = await buildTwice(primaryBuildSource, dependency.dependencyRoot, controls.build, options.buildAdapter);
    const rebuiltReproduction = await buildTwice(reproductionBuildSource, dependency.dependencyRoot, controls.build, options.buildAdapter);
    if (canonical(rebuilt.rows) !== canonical(suppliedRuntimeRows) || canonical(rebuiltReproduction.rows) !== canonical(reproductionRuntimeRows) ||
        !controls.build.expectedRuntimeFiles.every((filePath: string) => rebuilt.runtime[filePath].equals(readFileSync(checkedPath(runtimeRoot, filePath))) &&
          rebuiltReproduction.runtime[filePath].equals(readFileSync(checkedPath(reproductionRuntimeRoot, filePath))))) {
      throw new Error('CONTROLLED_SOURCE_RUNTIME_LINK_INVALID');
    }
    return {freezeCommitSha: controls.freezeCommitSha, profileSha256: profileSha, mutationSpecSha256: specSha,
      sourceCandidateHash: source.sourceCandidateHash, runtimeCandidateHash: rowsHash(rebuilt.rows), generationEvidenceSha256: evidenceSha256,
      dependencyIdentitySha256: dependency.identitySha256, executionInfrastructureIdentitySha256: controls.manifest.executionInfrastructureIdentitySha256,
      challengeManifestSha256: digest(canonical(challenge)), dependencyIdentity: controls.profile.dependencyIdentity, manifest};
  } finally { rmSync(temp, {recursive: true, force: true}); }
}

export function validateSingleCaseBinding(lane: string, binding: any, common: any) {
  const fields = ['challengeId', 'freezeCommitSha', 'profileSha256', 'mutationSpecSha256', 'sourceCandidateHash', 'runtimeCandidateHash', 'generationEvidenceSha256'];
  if (!['B0', 'B1', 'B2', 'B4'].includes(lane) || !binding || typeof binding !== 'object' ||
      canonical(Object.keys(binding).sort()) !== canonical([...fields, 'lane'].sort()) || binding.lane !== lane ||
      canonical(fields.map((field) => binding[field])) !== canonical(fields.map((field) => common[field])) ||
      !COMMIT.test(binding.freezeCommitSha) || fields.slice(2).some((field) => !HASH.test(binding[field])) ||
      binding.challengeId !== 'node-cache-ttl-zero-001') throw new Error('SINGLE_CASE_BINDING_INVALID');
  return true;
}

export {CONTROL_PATHS, digest as sha256, rowsHash as hashInventoryRows};
