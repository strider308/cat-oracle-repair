import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {isBuiltin} from 'node:module';
import path from 'node:path';
import {canonical} from '../oracle/canonical.ts';

export const FREEZE_V2_PATHS = {
  preCandidateFreeze: 'benchmark/protocol/pre-candidate-freeze-v2.json',
  executableClosure: 'benchmark/protocol/freeze-executable-closure-v2.json',
  supersession: 'benchmark/protocol/freeze-authority-supersession-v1.json',
  generationContractSupersession: 'benchmark/protocol/generation-contract-supersession-v1.json',
  authorityMatrix: 'benchmark/protocol/freeze-authority-v2-acceptance-matrix.json',
  closureSchema: 'benchmark/schemas/freeze-executable-closure-v2.schema.json',
  manifestSchema: 'benchmark/schemas/pre-candidate-freeze-v2.schema.json',
  authorityMatrixSchema: 'benchmark/schemas/freeze-authority-v2-acceptance-matrix.schema.json',
  prepareScript: 'scripts/cat-prepare-freeze-authority-v2.ts',
  authorityTests: 'tests/freeze-authority-v2.test.ts',
  generatorTests: 'tests/controlled-candidate-generator.test.ts',
  controlledProfileTests: 'tests/controlled-subject-profile.test.ts',
  protocolDocumentation: 'docs/BENCHMARK_PROTOCOL.md',
  trustedRunnerEntrypoint: 'scripts/cat-trusted-freeze-runner-v2.ts',
  trustedRunnerBootstrap: 'scripts/Invoke-CatTrustedFreezeRunnerV2.ps1',
  trustedRunnerTests: 'tests/cat-trusted-freeze-runner-v2.test.ts',
  attributes: '.gitattributes',
  profile: 'benchmark/protocol/controlled-subject-profile-v1.json',
  mutationSpec: 'benchmark/protocol/controlled-mutation-spec-v1.json',
  buildContract: 'benchmark/protocol/controlled-build-contract-v1.json',
  acceptanceMatrix: 'benchmark/protocol/controlled-profile-acceptance-matrix-v1.json',
  sameCandidateProtocol: 'benchmark/protocol/single-case-v2.json',
  challengeSchema: 'benchmark/schemas/controlled-challenge-manifest-v1.schema.json',
  generationEvidenceSchema: 'benchmark/schemas/controlled-generation-evidence-v2.schema.json',
  profileSchema: 'benchmark/schemas/controlled-subject-profile-v1.schema.json',
  receiptSchema: 'benchmark/schemas/controlled-benchmark-subject-receipt-v1.schema.json',
  singleCaseResultSchema: 'benchmark/schemas/single-case-result-v1.schema.json',
  subjectAdapter: 'src/evaluation/p03-subject-adapter.cjs',
  subjectExecutor: 'src/evaluation/p03-subject.ts',
} as const;

export const FREEZE_V2_ENTRYPOINTS = ['scripts/cat-generate-controlled-candidate.ts', 'scripts/cat-subject.ts',
  FREEZE_V2_PATHS.trustedRunnerEntrypoint, 'src/benchmark/controlled-candidate-generator.ts', 'src/evaluation/p03-subject.ts', 'src/evaluation/p03-subject-adapter.cjs'];
const CONTROL_ARTIFACTS = [FREEZE_V2_PATHS.profile, FREEZE_V2_PATHS.mutationSpec, FREEZE_V2_PATHS.buildContract,
  FREEZE_V2_PATHS.acceptanceMatrix, FREEZE_V2_PATHS.sameCandidateProtocol, FREEZE_V2_PATHS.challengeSchema,
  FREEZE_V2_PATHS.generationEvidenceSchema, FREEZE_V2_PATHS.profileSchema, FREEZE_V2_PATHS.receiptSchema,
  FREEZE_V2_PATHS.singleCaseResultSchema, FREEZE_V2_PATHS.executableClosure, FREEZE_V2_PATHS.supersession,
  FREEZE_V2_PATHS.generationContractSupersession,
  FREEZE_V2_PATHS.authorityMatrix, FREEZE_V2_PATHS.closureSchema, FREEZE_V2_PATHS.manifestSchema,
  FREEZE_V2_PATHS.authorityMatrixSchema, FREEZE_V2_PATHS.prepareScript, FREEZE_V2_PATHS.authorityTests,
  FREEZE_V2_PATHS.generatorTests, FREEZE_V2_PATHS.protocolDocumentation, FREEZE_V2_PATHS.trustedRunnerBootstrap,
  FREEZE_V2_PATHS.controlledProfileTests, FREEZE_V2_PATHS.trustedRunnerTests, FREEZE_V2_PATHS.attributes];
const SUPPORT = [FREEZE_V2_PATHS.preCandidateFreeze, ...CONTROL_ARTIFACTS];
const SOURCE_TREE_ROOTS = ['scripts', 'src'];
const AUTHORITY_TREE_PATHS = [...SOURCE_TREE_ROOTS, FREEZE_V2_PATHS.preCandidateFreeze, ...CONTROL_ARTIFACTS];
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const OBJECT = /^[a-f0-9]{40}$/;
const EXTENSIONS = ['.ts', '.js', '.cjs', '.mjs', '.json'];
const IMPORTS = /(?:\b(?:import|export)\s+(?:[\s\S]*?\s+from\s*)?|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"]+)['"]/g;
const WORKTREE_NORMALIZATION_POLICY = 'CRLF_TO_LF_V1';
const REQUIRED_MATRIX_IDS = ['COMMIT_BLOB_IS_AUTHORITY', 'COMMIT_GRAPH_IS_AUTHORITY', 'TEMP_INDEX_MODELS_FUTURE_TREE',
  'REAL_INDEX_UNCHANGED', 'LF_CHECKOUT_ACCEPTED', 'CRLF_GIT_CLEAN_CHECKOUT_ACCEPTED', 'SEMANTIC_WORKTREE_MUTATION_REJECTED',
  'STAGED_EXECUTABLE_MUTATION_REJECTED', 'CUSTOM_CLEAN_FILTER_REJECTED', 'WORKING_TREE_ENCODING_REJECTED', 'SYMLINK_REJECTED',
  'TRANSITIVE_IMPORT_MUTATION_REJECTED', 'MISSING_TRANSITIVE_MODULE_REJECTED', 'UNRESOLVED_DYNAMIC_IMPORT_REJECTED',
  'COMMITTED_CLOSURE_ROW_TAMPER_REJECTED', 'FAILED_V1_AUTHORITY_REJECTED', 'POSITIVE_V2_AUTHORITY_LOAD_SUCCEEDS',
  'V1_FALLBACK_NOT_ALLOWED', 'TRUSTED_RUNNER_EXECUTES_FROM_FREEZE_COMMIT', 'TRUSTED_RUNNER_HEAD_MUST_MATCH_FREEZE_SHA',
  'MUTABLE_TARGET_VERIFIER_NOT_EXECUTION_AUTHORITY', 'TARGET_WORKTREE_DRIFT_REJECTED', 'TRUSTED_PREFLIGHT_HAS_NO_GENERATION_SIDE_EFFECT',
  'TRUSTED_GENERATE_MODE_REQUIRES_PREFLIGHT', 'TRUSTED_RUNNER_INCLUDED_IN_EXECUTABLE_CLOSURE', 'RUNNER_TEMP_WORKTREE_REMOVED',
  'SCIENTIFIC_MUTATION_UNCHANGED', 'BUILD_CONTRACT_UNCHANGED',
  'SAME_CANDIDATE_PROTOCOL_UNCHANGED', 'NO_REAL_CANDIDATE_CREATED', 'NO_RESULT_OBSERVED', 'GENERATION_CONTRACT_SUPERSESSION_BOUND',
  'POST_GENERATION_SUITE_SAFE'];

export type ClosureRowV2 = {path: string; gitMode: '100644' | '100755'; gitBlobObjectId: string; commitBlobSha256: string};
type FrozenControlsV2 = {freezeCommitSha: string; manifest: any; profile: any; spec: any; build: any; protocol: any; bytes: Record<string, Buffer>};
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const rowsHash = (rows: unknown) => sha256(canonical(rows));
const blobCache = new Map<string, Buffer>();

function git(root: string, args: string[], encoding: BufferEncoding | 'buffer' = 'buffer', env: NodeJS.ProcessEnv = {}): Buffer | string {
  return execFileSync(process.env.CAT_TRUSTED_GIT_PATH || 'git', ['-C', root, ...args], {encoding, env: {...process.env, GIT_OPTIONAL_LOCKS: '0', ...env}, stdio: ['ignore', 'pipe', 'pipe']}) as Buffer | string;
}
function isolatedObjectEnvironment(repoRoot: string, tempRoot: string) {
  const objectPath = String(git(repoRoot, ['rev-parse', '--git-path', 'objects'], 'utf8')).trim();
  const primaryObjects = path.resolve(repoRoot, objectPath);
  const privateObjects = path.join(tempRoot, 'objects');
  mkdirSync(privateObjects, {recursive: true});
  return {GIT_OBJECT_DIRECTORY: privateObjects, GIT_ALTERNATE_OBJECT_DIRECTORIES: primaryObjects};
}
function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value) &&
    !value.includes(':') && !/[\x00-\x1f\x7f]/.test(value) && value.split('/').every((part) => part && part !== '.' && part !== '..');
}
function exactKeys(value: any, keys: string[]) {
  return value && typeof value === 'object' && !Array.isArray(value) && canonical(Object.keys(value).sort()) === canonical([...keys].sort());
}
function commitTree(root: string, commitSha: string, paths = SOURCE_TREE_ROOTS, env: NodeJS.ProcessEnv = {}): Map<string, {mode: string; oid: string}> {
  if (paths.some((filePath) => !safePath(filePath))) throw new Error('CONTROLLED_PATH_INVALID');
  const output = git(root, ['--literal-pathspecs', 'ls-tree', '-rz', '-r', '--full-tree', commitSha, '--', ...paths], 'buffer', env) as Buffer;
  const tree = new Map<string, {mode: string; oid: string}>();
  for (const entry of output.toString('binary').split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    if (tab < 0) throw new Error('FREEZE_COMMIT_TREE_INVALID');
    const [mode, type, oid] = entry.slice(0, tab).split(' ');
    const filePath = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.from(entry.slice(tab + 1), 'binary'));
    if (!safePath(filePath) || type !== 'blob' || !OBJECT.test(oid) || tree.has(filePath)) throw new Error('FREEZE_COMMIT_TREE_INVALID');
    tree.set(filePath, {mode, oid});
  }
  const folded = new Set<string>();
  for (const filePath of tree.keys()) {
    const key = filePath.toLocaleLowerCase('en-US');
    if (folded.has(key)) throw new Error('FREEZE_COMMIT_CASE_COLLISION');
    folded.add(key);
  }
  return tree;
}
function blob(root: string, oid: string, env: NodeJS.ProcessEnv = {}) {
  let value = blobCache.get(oid);
  if (!value) { value = git(root, ['cat-file', 'blob', oid], 'buffer', env) as Buffer; blobCache.set(oid, value); }
  return value;
}
function sourceText(bytes: Buffer) {
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { throw new Error('FREEZE_CODE_CLOSURE_INVALID_UTF8'); }
}
function normalizeWorktreeBytes(bytes: Buffer) {
  return Buffer.from(bytes.toString('binary').replace(/\r\n/g, '\n'), 'binary');
}
function resolveImport(tree: Map<string, {mode: string; oid: string}>, from: string, specifier: string): string {
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  if (joined.startsWith('../') || joined === '..' || !safePath(joined)) throw new Error('FREEZE_CODE_CLOSURE_UNRESOLVED');
  const candidates = path.posix.extname(joined) ? [joined] : [joined, ...EXTENSIONS.map((ext) => joined + ext), ...EXTENSIONS.map((ext) => `${joined}/index${ext}`)];
  const found = candidates.filter((candidate) => tree.has(candidate) && !candidate.split('/').includes('node_modules'));
  if (found.length !== 1) throw new Error('FREEZE_CODE_CLOSURE_UNRESOLVED');
  return found[0];
}
export function inventoryExecutableClosureAtCommit(repoRoot: string, commitSha: string, entrypoints = FREEZE_V2_ENTRYPOINTS, env: NodeJS.ProcessEnv = {}): ClosureRowV2[] {
  const tree = commitTree(repoRoot, commitSha, SOURCE_TREE_ROOTS, env), pending = [...entrypoints], seen = new Set<string>();
  while (pending.length) {
    const filePath = pending.pop()!;
    if (!safePath(filePath)) throw new Error('FREEZE_CODE_CLOSURE_UNRESOLVED');
    if (seen.has(filePath)) continue;
    const entry = tree.get(filePath);
    if (!entry || !['100644', '100755'].includes(entry.mode) || !EXTENSIONS.includes(path.posix.extname(filePath))) throw new Error(`FREEZE_CODE_CLOSURE_UNRESOLVED:${filePath}`);
    seen.add(filePath);
    const source = sourceText(blob(repoRoot, entry.oid, env)), specifiers = new Set([...source.matchAll(IMPORTS)].map((match) => match[1]));
    const dynamic = [...source.matchAll(/\b(import|require)\s*\(([^)]*)\)/g)].filter(([, , arg]) => !/^\s*(['"])[^'"]*\1\s*$/.test(arg));
    const candidateLoader = filePath === FREEZE_V2_PATHS.subjectAdapter && dynamic.length === 1 && dynamic[0][1] === 'require' && dynamic[0][2].trim() === 'entrypoint';
    if (dynamic.length && !candidateLoader) throw new Error('FREEZE_CODE_CLOSURE_UNRESOLVED');
    for (const specifier of specifiers) {
      if (isBuiltin(specifier) || specifier.startsWith('node:')) continue;
      if (!specifier.startsWith('.')) throw new Error('FREEZE_CODE_CLOSURE_UNRESOLVED');
      pending.push(resolveImport(tree, filePath, specifier));
    }
  }
  return [...seen].sort().map((filePath) => {
    const {mode, oid} = tree.get(filePath)!;
    return {path: filePath, gitMode: mode as '100644' | '100755', gitBlobObjectId: oid, commitBlobSha256: sha256(blob(repoRoot, oid, env))};
  });
}

export function assertNoSymlinkedAncestors(basePath: string, targetPath: string, inspect = lstatSync) {
  const base = path.resolve(basePath), target = path.resolve(targetPath);
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('CONTROLLED_PATH_INVALID');
  if (inspect(base).isSymbolicLink()) throw new Error('CONTROLLED_SYMLINK_REJECTED');
  let current = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    current = path.join(current, part);
    try { if (inspect(current).isSymbolicLink()) throw new Error('CONTROLLED_SYMLINK_REJECTED'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
function checkedWorkingPath(repoRoot: string, filePath: string): string {
  if (!safePath(filePath)) throw new Error('CONTROLLED_PATH_INVALID');
  const base = path.resolve(repoRoot), target = path.resolve(base, ...filePath.split('/'));
  if (!target.startsWith(base + path.sep)) throw new Error('CONTROLLED_PATH_INVALID');
  assertNoSymlinkedAncestors(base, target);
  return target;
}
function verifyAttributes(repoRoot: string, commitSha: string, filePaths: string[]) {
  const args = ['--literal-pathspecs', 'check-attr', '-z', '--source=' + commitSha, 'filter', 'working-tree-encoding', '--', ...filePaths];
  const committed = git(repoRoot, args) as Buffer;
  const effective = git(repoRoot, ['--literal-pathspecs', 'check-attr', '-z', 'filter', 'working-tree-encoding', '--', ...filePaths]) as Buffer;
  for (const output of [committed, effective]) {
    const parts = output.toString('utf8').split('\0').filter(Boolean);
    if (parts.length % 3) throw new Error('FREEZE_ATTRIBUTE_POLICY_INVALID');
    for (let i = 0; i < parts.length; i += 3) {
      const attribute = parts[i + 1], value = parts[i + 2];
      if (attribute === 'filter' && !['unspecified', 'unset'].includes(value)) throw new Error('FREEZE_CUSTOM_FILTER_REJECTED');
      if (attribute === 'working-tree-encoding' && value !== 'unspecified') throw new Error('FREEZE_WORKING_TREE_ENCODING_REJECTED');
    }
  }
  if (committed.toString('utf8') !== effective.toString('utf8')) throw new Error('FREEZE_ATTRIBUTE_POLICY_MISMATCH');
}
function assertCleanStagedDiff(repoRoot: string, commitSha: string, filePath: string) {
  const args = ['--literal-pathspecs', 'diff', '--cached', commitSha, '--quiet', '--no-ext-diff', '--no-textconv', '--', filePath];
  try { git(repoRoot, args); } catch (error: any) { if (error?.status === 1) throw new Error('FREEZE_STAGED_MUTATION_REJECTED'); throw error; }
}
function verifyIndexFlags(repoRoot: string, paths: string[]) {
  const output = git(repoRoot, ['--literal-pathspecs', 'ls-files', '-v', '-t', '-z', '--', ...paths]) as Buffer;
  for (const entry of output.toString('utf8').split('\0').filter(Boolean)) {
    const flag = entry[0];
    if (flag === 'h' || flag === 'S' || flag === 's') throw new Error('FREEZE_INDEX_FLAGS_REJECTED');
  }
}

export function verifyV2WorktreeEquivalence(repoRoot: string, commitSha: string, rows: ClosureRowV2[], supportPaths: string[] = []) {
  const paths = [...new Set([...rows.map((row) => row.path), ...supportPaths])].sort();
  const tree = commitTree(repoRoot, commitSha, [...SOURCE_TREE_ROOTS, ...supportPaths]);
  verifyAttributes(repoRoot, commitSha, paths);
  verifyIndexFlags(repoRoot, paths);
  const indexPath = path.join(mkdtempSync(path.join(repoRoot, '.tmp-cat-v2-check-')), 'index');
  const env = {GIT_INDEX_FILE: indexPath, ...isolatedObjectEnvironment(repoRoot, path.dirname(indexPath))};
  try {
    git(repoRoot, ['read-tree', commitSha], 'buffer', env);
    for (const filePath of paths) {
      const expected = tree.get(filePath);
      if (!expected || !['100644', '100755'].includes(expected.mode)) throw new Error('FREEZE_CONTROL_BLOB_INVALID');
      const working = checkedWorkingPath(repoRoot, filePath);
      if (!existsSync(working) || !lstatSync(working).isFile()) throw new Error('FREEZE_WORKTREE_FILE_INVALID');
      assertCleanStagedDiff(repoRoot, commitSha, filePath);
    }
    // Re-add through an isolated index to defeat stale Git stat data while applying ordinary text/eol normalization.
    git(repoRoot, ['--literal-pathspecs', 'add', '--', ...paths], 'buffer', env);
    const refreshed = git(repoRoot, ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...paths], 'buffer', env) as Buffer;
    const stagedEntries = refreshed.toString('utf8').split('\0').filter(Boolean);
    const byPath = new Map<string, {mode: string; oid: string}>();
    for (const entry of stagedEntries) {
      const match = /^(100644|100755) ([a-f0-9]{40}) \d\t(.+)$/.exec(entry);
      if (!match || byPath.has(match[3])) throw new Error('FREEZE_WORKTREE_BLOB_INVALID');
      byPath.set(match[3], {mode: match[1], oid: match[2]});
    }
    for (const filePath of paths) {
      const expected = tree.get(filePath)!, actual = byPath.get(filePath);
      if (!actual || actual.mode !== expected.mode) throw new Error('FREEZE_WORKTREE_MUTATION_REJECTED');
      if (actual.oid !== expected.oid && !normalizeWorktreeBytes(readFileSync(checkedWorkingPath(repoRoot, filePath))).equals(blob(repoRoot, expected.oid))) {
        throw new Error('FREEZE_WORKTREE_MUTATION_REJECTED');
      }
    }
    for (const row of rows) if (sha256(blob(repoRoot, row.gitBlobObjectId)) !== row.commitBlobSha256) throw new Error('FREEZE_CLOSURE_BLOB_MISMATCH');
  } finally { rmSync(path.dirname(indexPath), {recursive: true, force: true, maxRetries: 20, retryDelay: 100}); }
}

export function verifyV2CommitAuthority(repoRoot: string, freezeCommitSha: string) {
  if (!COMMIT.test(freezeCommitSha)) throw new Error('FREEZE_COMMIT_SHA_REQUIRED');
  try { git(repoRoot, ['cat-file', '-e', `${freezeCommitSha}^{commit}`]); } catch { throw new Error('FREEZE_COMMIT_NOT_FOUND'); }
  const tree = commitTree(repoRoot, freezeCommitSha, AUTHORITY_TREE_PATHS), manifestEntry = tree.get(FREEZE_V2_PATHS.preCandidateFreeze);
  if (!manifestEntry) throw new Error('FREEZE_AUTHORITY_VERSION_UNSUPPORTED');
  const manifestBytes = blob(repoRoot, manifestEntry.oid);
  let manifest: any; try { manifest = JSON.parse(sourceText(manifestBytes)); } catch { throw new Error('FREEZE_V2_MANIFEST_INVALID'); }
  const expectedKeys = ['manifestVersion', 'status', 'futureAnchor', 'artifacts', 'executableClosureVersion', 'executableClosureSha256',
    'profileSha256', 'mutationSpecSha256', 'buildContractSha256', 'sameCandidateProtocolSha256', 'acceptanceMatrixSha256',
    'dependencyIdentityVersion', 'dependencyIdentitySha256', 'dependencyLockSha256', 'executionInfrastructureIdentitySha256',
    'generatorSourceIdentitySha256', 'controlledGateSourceIdentitySha256', 'sameCandidateContractSha256', 'attributePolicyPath', 'attributePolicySha256',
    'worktreeNormalizationPolicy', 'trustedRunnerVersion', 'trustedRunnerEntrypointPath', 'trustedRunnerSourceIdentitySha256'];
  if (!exactKeys(manifest, expectedKeys) || manifest.manifestVersion !== 'PreCandidateFreezeV2' || manifest.status !== 'READY_FOR_OWNER_FREEZE_COMMIT' ||
      manifest.futureAnchor !== 'freezeCommitSha' || manifest.attributePolicyPath !== FREEZE_V2_PATHS.attributes ||
      manifest.worktreeNormalizationPolicy !== WORKTREE_NORMALIZATION_POLICY || manifest.trustedRunnerVersion !== 'TrustedCommittedRunnerV1' ||
      manifest.trustedRunnerEntrypointPath !== FREEZE_V2_PATHS.trustedRunnerEntrypoint || !HASH.test(manifest.trustedRunnerSourceIdentitySha256) ||
      !exactKeys(manifest.artifacts, CONTROL_ARTIFACTS)) throw new Error('FREEZE_V2_MANIFEST_INVALID');
  const bytes: Record<string, Buffer> = {[FREEZE_V2_PATHS.preCandidateFreeze]: manifestBytes};
  for (const filePath of CONTROL_ARTIFACTS) {
    const entry = tree.get(filePath), expected = manifest.artifacts[filePath];
    if (!entry || !['100644', '100755'].includes(entry.mode) || !HASH.test(expected)) throw new Error('FREEZE_V2_ARTIFACT_BINDING_INVALID');
    const content = blob(repoRoot, entry.oid);
    if (sha256(content) !== expected) throw new Error('FREEZE_V2_ARTIFACT_HASH_MISMATCH');
    bytes[filePath] = content;
  }
  const closure: any = JSON.parse(sourceText(bytes[FREEZE_V2_PATHS.executableClosure]));
  if (!exactKeys(closure, ['version', 'rows']) || closure.version !== 'FreezeExecutableClosureV2' || !Array.isArray(closure.rows) ||
      !closure.rows.every((row: any) => exactKeys(row, ['path', 'gitMode', 'gitBlobObjectId', 'commitBlobSha256']) && safePath(row.path) &&
        ['100644', '100755'].includes(row.gitMode) && OBJECT.test(row.gitBlobObjectId) && HASH.test(row.commitBlobSha256)) ||
      closure.rows.some((row: ClosureRowV2, i: number) => i > 0 && closure.rows[i - 1].path >= row.path) || rowsHash(closure.rows) !== manifest.executableClosureSha256 ||
      manifest.executableClosureVersion !== closure.version) throw new Error('FREEZE_V2_CLOSURE_INVALID');
  for (const row of closure.rows as ClosureRowV2[]) {
    const entry = tree.get(row.path);
    if (!entry || entry.mode !== row.gitMode || entry.oid !== row.gitBlobObjectId || sha256(blob(repoRoot, entry.oid)) !== row.commitBlobSha256) throw new Error('FREEZE_V2_CLOSURE_BLOB_MISMATCH');
    bytes[row.path] = blob(repoRoot, entry.oid);
  }
  const actualRows = inventoryExecutableClosureAtCommit(repoRoot, freezeCommitSha);
  if (canonical(actualRows) !== canonical(closure.rows)) throw new Error('FREEZE_V2_CLOSURE_GRAPH_MISMATCH');
  const attributes = tree.get(FREEZE_V2_PATHS.attributes);
  if (attributes && (manifest.attributePolicySha256 !== sha256(blob(repoRoot, attributes.oid)))) throw new Error('FREEZE_ATTRIBUTE_POLICY_MISMATCH');
  verifyV2WorktreeEquivalence(repoRoot, freezeCommitSha, closure.rows, [...CONTROL_ARTIFACTS, FREEZE_V2_PATHS.preCandidateFreeze]);
  const parse = (key: string) => JSON.parse(sourceText(bytes[key]));
  const profile = parse(FREEZE_V2_PATHS.profile), spec = parse(FREEZE_V2_PATHS.mutationSpec), build = parse(FREEZE_V2_PATHS.buildContract);
  const protocol = parse(FREEZE_V2_PATHS.sameCandidateProtocol), matrix = parse(FREEZE_V2_PATHS.authorityMatrix), controlsMatrix = parse(FREEZE_V2_PATHS.acceptanceMatrix);
  const infra = profile.controlledExecutionInfrastructureV2, infraProjection = {...infra}; delete infraProjection.identitySha256;
  if (!exactKeys(matrix, ['version', 'rows']) || matrix.version !== 'FreezeAuthorityV2AcceptanceMatrix' || !Array.isArray(matrix.rows) ||
      canonical(matrix.rows.map((row: any) => row.id).sort()) !== canonical([...REQUIRED_MATRIX_IDS].sort()) ||
      matrix.rows.some((row: any) => !exactKeys(row, ['id', 'status', 'implementationEvidence', 'testEvidence']) || row.status !== 'PASS' ||
        typeof row.implementationEvidence !== 'string' || !row.implementationEvidence.trim() || typeof row.testEvidence !== 'string' || !row.testEvidence.trim()) ||
      profile.status !== 'READY_FOR_OWNER_FREEZE_REVIEW' || profile.candidateCreated !== false || profile.competitiveLanesExecuted !== false ||
      profile.maliciousCodeIsolationClaim !== false || profile.arbitraryExternalSubjectSupport !== 'NOT_APPROVED' ||
      spec.behavioralClass !== 'TTL_ZERO_DELETES_EXISTING_ENTRY' || spec.alternatives?.length !== 0 || spec.fallbacks?.length !== 0 ||
      spec.transform?.oldText !== 'if ttl >= 0' || spec.transform?.newText !== 'if ttl > 0' || spec.transform?.matchCount !== 1 ||
      build.contractVersion !== 'ControlledBuildContractV1' || protocol.protocolVersion !== 'SingleCaseProtocolV2' ||
      infra?.identityVersion !== 'ExecutionInfrastructureIdentityV2' || infra.identitySha256 !== rowsHash(infraProjection) ||
      infra.subjectAdapterPath !== FREEZE_V2_PATHS.subjectAdapter || infra.executorPath !== FREEZE_V2_PATHS.subjectExecutor ||
      infra.subjectAdapterSha256 !== sha256(bytes[FREEZE_V2_PATHS.subjectAdapter]) || infra.executorSha256 !== sha256(bytes[FREEZE_V2_PATHS.subjectExecutor]) ||
      canonical(controlsMatrix.controlledProfileRequirements?.map((row: any) => row.id).sort()) !== canonical([...profile.controlledProfileRequirements].sort())) throw new Error('FREEZE_CONTROL_INVARIANT_FAILED');
  if (manifest.profileSha256 !== manifest.artifacts[FREEZE_V2_PATHS.profile] || manifest.mutationSpecSha256 !== manifest.artifacts[FREEZE_V2_PATHS.mutationSpec] ||
      manifest.buildContractSha256 !== manifest.artifacts[FREEZE_V2_PATHS.buildContract] || manifest.sameCandidateProtocolSha256 !== manifest.artifacts[FREEZE_V2_PATHS.sameCandidateProtocol] ||
      manifest.acceptanceMatrixSha256 !== manifest.artifacts[FREEZE_V2_PATHS.acceptanceMatrix] || profile.acceptanceMatrixSha256 !== manifest.acceptanceMatrixSha256 ||
      manifest.dependencyIdentityVersion !== 'DependencyInventoryV1' || manifest.dependencyIdentitySha256 !== profile.dependencyIdentity.inventorySha256 ||
      manifest.dependencyLockSha256 !== build.dependency.lockfileSha256 || manifest.executionInfrastructureIdentitySha256 !== infra.identitySha256 ||
      infra.buildContractSha256 !== manifest.buildContractSha256 || manifest.generatorSourceIdentitySha256 !== rowsHash(closure.rows) ||
      manifest.controlledGateSourceIdentitySha256 !== rowsHash(closure.rows) || manifest.sameCandidateContractSha256 !== manifest.sameCandidateProtocolSha256 ||
      manifest.attributePolicySha256 !== sha256(bytes[FREEZE_V2_PATHS.attributes]) ||
      manifest.trustedRunnerSourceIdentitySha256 !== rowsHash(closure.rows.filter((row: ClosureRowV2) => row.path === FREEZE_V2_PATHS.trustedRunnerEntrypoint)) ||
      !closure.rows.some((row: ClosureRowV2) => row.path === FREEZE_V2_PATHS.trustedRunnerEntrypoint) || build.runtime.nodeVersion !== infra.nodeRuntimeVersion ||
      build.runtime.containerImageDigest !== infra.containerImageDigest) throw new Error('FREEZE_V2_MANIFEST_BINDING_INVALID');
  const supersession = JSON.parse(sourceText(bytes[FREEZE_V2_PATHS.supersession]));
  if (supersession.version !== 'FreezeAuthoritySupersessionV1' || supersession.failedFreezeCommitSha !== 'cd272debfde43ea3dfbdb39b16a47b97341e0218' ||
      supersession.status !== 'INVALID_BEFORE_GENERATION' || supersession.successorFreezeCommitSha !== null) throw new Error('FREEZE_V2_SUPERSESSION_INVALID');
  const generationSupersession = JSON.parse(sourceText(bytes[FREEZE_V2_PATHS.generationContractSupersession]));
  if (!exactKeys(generationSupersession, ['recordVersion', 'supersededFreezeCommitSha', 'authorityStatus', 'generationStatus', 'status', 'reason',
    'trustedGenerateInvocationCount', 'realMutationExecuted', 'candidateCreated', 'competitiveResultsObserved', 'successorFreezeCommitSha']) ||
      generationSupersession.recordVersion !== 'GenerationContractSupersessionV1' || generationSupersession.supersededFreezeCommitSha !== '75f8b6ad870c3f385f793d5c77a44b3301d1cc8e' ||
      generationSupersession.authorityStatus !== 'VALID' || generationSupersession.generationStatus !== 'NOT_EXECUTED' ||
      generationSupersession.status !== 'SUPERSEDED_BEFORE_GENERATION' ||
      generationSupersession.reason !== 'FROZEN_GENERATOR_DID_NOT_EMIT_REQUIRED_SEPARATE_ROOT_SOURCE_AND_FULL_GENERATION_REPRODUCIBILITY_EVIDENCE' ||
      generationSupersession.trustedGenerateInvocationCount !== 0 || generationSupersession.realMutationExecuted !== false ||
      generationSupersession.candidateCreated !== false || generationSupersession.competitiveResultsObserved !== false ||
      generationSupersession.successorFreezeCommitSha !== null) throw new Error('GENERATION_CONTRACT_SUPERSESSION_INVALID');
  return {freezeCommitSha, manifest, profile, spec, build, protocol, bytes} satisfies FrozenControlsV2;
}

export function loadFrozenControlsV2(repoRoot: string, freezeCommitSha: string): FrozenControlsV2 {
  return verifyV2CommitAuthority(repoRoot, freezeCommitSha);
}

export function prepareFreezeAuthorityV2(repoRoot: string, baseCommitSha: string, allowlist: string[]) {
  if (!COMMIT.test(baseCommitSha)) throw new Error('FREEZE_BASE_COMMIT_REQUIRED');
  try { git(repoRoot, ['cat-file', '-e', `${baseCommitSha}^{commit}`]); } catch { throw new Error('FREEZE_BASE_COMMIT_NOT_FOUND'); }
  const paths = [...new Set(allowlist)].sort();
  if (paths.some((filePath) => !safePath(filePath)) || paths.includes(FREEZE_V2_PATHS.preCandidateFreeze) || paths.includes(FREEZE_V2_PATHS.executableClosure)) throw new Error('FREEZE_ALLOWLIST_INVALID');
  const realIndexPath = String(git(repoRoot, ['rev-parse', '--git-path', 'index'], 'utf8')).trim();
  const resolvedIndexPath = path.resolve(repoRoot, realIndexPath);
  const initialIndex = existsSync(resolvedIndexPath) ? readFileSync(resolvedIndexPath) : undefined;
  const tempRoot = mkdtempSync(path.join(repoRoot, '.tmp-cat-freeze-v2-index-'));
  const indexPath = path.join(tempRoot, 'index');
  const env = {GIT_INDEX_FILE: indexPath, ...isolatedObjectEnvironment(repoRoot, tempRoot)};
  try {
    const baseRows = inventoryExecutableClosureAtCommit(repoRoot, baseCommitSha,
      FREEZE_V2_ENTRYPOINTS.filter((entrypoint) => entrypoint !== FREEZE_V2_PATHS.trustedRunnerEntrypoint));
    const checkPaths = [...new Set([...paths, ...baseRows.map((row) => row.path), ...CONTROL_ARTIFACTS])].sort();
    verifyIndexFlags(repoRoot, checkPaths);
    for (const filePath of checkPaths) assertCleanStagedDiff(repoRoot, baseCommitSha, filePath);
    const attrs = git(repoRoot, ['--literal-pathspecs', 'check-attr', '-z', 'filter', 'working-tree-encoding', '--', ...checkPaths], 'buffer') as Buffer;
    const attrParts = attrs.toString('utf8').split('\0').filter(Boolean);
    if (attrParts.length % 3) throw new Error('FREEZE_ATTRIBUTE_POLICY_INVALID');
    for (let i = 0; i < attrParts.length; i += 3) {
      if (attrParts[i + 1] === 'filter' && !['unspecified', 'unset'].includes(attrParts[i + 2])) throw new Error('FREEZE_CUSTOM_FILTER_REJECTED');
      if (attrParts[i + 1] === 'working-tree-encoding' && attrParts[i + 2] !== 'unspecified') throw new Error('FREEZE_WORKING_TREE_ENCODING_REJECTED');
    }
    const baseTree = commitTree(repoRoot, baseCommitSha, AUTHORITY_TREE_PATHS);
    for (const filePath of [...new Set([...baseRows.map((row) => row.path), ...CONTROL_ARTIFACTS])]) {
      if (paths.includes(filePath)) continue;
      const entry = baseTree.get(filePath);
      if (!entry) continue;
      const working = checkedWorkingPath(repoRoot, filePath);
      if (!existsSync(working) || !lstatSync(working).isFile() ||
          !normalizeWorktreeBytes(readFileSync(working)).equals(blob(repoRoot, entry.oid))) throw new Error('FREEZE_PREPARATION_UNLISTED_CHANGE');
    }
    git(repoRoot, ['read-tree', baseCommitSha], 'buffer', env);
    git(repoRoot, ['--literal-pathspecs', 'add', '--', ...paths], 'buffer', env);
    const firstTree = String(git(repoRoot, ['write-tree'], 'utf8', env)).trim();
    const firstEntries = commitTree(repoRoot, firstTree, AUTHORITY_TREE_PATHS, env);
    if (CONTROL_ARTIFACTS.some((filePath) => filePath !== FREEZE_V2_PATHS.executableClosure && !firstEntries.has(filePath))) throw new Error('FREEZE_PREPARATION_ARTIFACT_MISSING');
    const initialRows = inventoryExecutableClosureAtCommit(repoRoot, firstTree, FREEZE_V2_ENTRYPOINTS, env);
    const closureDocument = {version: 'FreezeExecutableClosureV2', rows: initialRows};
    const closurePath = checkedWorkingPath(repoRoot, FREEZE_V2_PATHS.executableClosure);
    writeFileSync(closurePath, JSON.stringify(closureDocument, null, 2) + '\n');
    git(repoRoot, ['--literal-pathspecs', 'add', '--', FREEZE_V2_PATHS.executableClosure], 'buffer', env);
    const preManifestTree = String(git(repoRoot, ['write-tree'], 'utf8', env)).trim();
    const tree = commitTree(repoRoot, preManifestTree, AUTHORITY_TREE_PATHS, env);
    const artifacts: Record<string, string> = {};
    for (const filePath of CONTROL_ARTIFACTS) {
      const entry = tree.get(filePath);
      if (!entry || !['100644', '100755'].includes(entry.mode)) throw new Error('FREEZE_PREPARATION_ARTIFACT_MISSING');
      artifacts[filePath] = sha256(blob(repoRoot, entry.oid, env));
    }
    const readArtifact = (filePath: string) => JSON.parse(sourceText(blob(repoRoot, tree.get(filePath)!.oid, env)));
    const profile = readArtifact(FREEZE_V2_PATHS.profile), build = readArtifact(FREEZE_V2_PATHS.buildContract);
    const closureBytes = blob(repoRoot, tree.get(FREEZE_V2_PATHS.executableClosure)!.oid, env);
    if (sha256(closureBytes) !== artifacts[FREEZE_V2_PATHS.executableClosure] ||
        canonical(inventoryExecutableClosureAtCommit(repoRoot, preManifestTree, FREEZE_V2_ENTRYPOINTS, env)) !== canonical(initialRows)) throw new Error('FREEZE_PREPARATION_CLOSURE_DRIFT');
    const attributeEntry = tree.get(FREEZE_V2_PATHS.attributes);
    if (!attributeEntry) throw new Error('FREEZE_ATTRIBUTE_POLICY_MISSING');
    const manifest = {manifestVersion: 'PreCandidateFreezeV2', status: 'READY_FOR_OWNER_FREEZE_COMMIT', futureAnchor: 'freezeCommitSha', artifacts,
      executableClosureVersion: 'FreezeExecutableClosureV2', executableClosureSha256: rowsHash(initialRows),
      profileSha256: artifacts[FREEZE_V2_PATHS.profile], mutationSpecSha256: artifacts[FREEZE_V2_PATHS.mutationSpec],
      buildContractSha256: artifacts[FREEZE_V2_PATHS.buildContract], sameCandidateProtocolSha256: artifacts[FREEZE_V2_PATHS.sameCandidateProtocol],
      acceptanceMatrixSha256: artifacts[FREEZE_V2_PATHS.acceptanceMatrix], dependencyIdentityVersion: 'DependencyInventoryV1',
      dependencyIdentitySha256: profile.dependencyIdentity.inventorySha256, dependencyLockSha256: build.dependency.lockfileSha256,
      executionInfrastructureIdentitySha256: profile.controlledExecutionInfrastructureV2.identitySha256,
      generatorSourceIdentitySha256: rowsHash(initialRows), controlledGateSourceIdentitySha256: rowsHash(initialRows),
      sameCandidateContractSha256: artifacts[FREEZE_V2_PATHS.sameCandidateProtocol], attributePolicyPath: FREEZE_V2_PATHS.attributes,
      trustedRunnerVersion: 'TrustedCommittedRunnerV1', trustedRunnerEntrypointPath: FREEZE_V2_PATHS.trustedRunnerEntrypoint,
      trustedRunnerSourceIdentitySha256: rowsHash(initialRows.filter((row) => row.path === FREEZE_V2_PATHS.trustedRunnerEntrypoint)),
      attributePolicySha256: sha256(blob(repoRoot, attributeEntry.oid, env)), worktreeNormalizationPolicy: WORKTREE_NORMALIZATION_POLICY};
    writeFileSync(checkedWorkingPath(repoRoot, FREEZE_V2_PATHS.preCandidateFreeze), JSON.stringify(manifest, null, 2) + '\n');
    git(repoRoot, ['--literal-pathspecs', 'add', '--', FREEZE_V2_PATHS.preCandidateFreeze], 'buffer', env);
    const finalTree = String(git(repoRoot, ['write-tree'], 'utf8', env)).trim();
    const finalEntries = commitTree(repoRoot, finalTree, AUTHORITY_TREE_PATHS, env);
    for (const [filePath, expected] of Object.entries(artifacts)) {
      const entry = finalEntries.get(filePath);
      if (!entry || sha256(blob(repoRoot, entry.oid, env)) !== expected) throw new Error('FREEZE_PREPARATION_ARTIFACT_MISMATCH');
    }
    const finalManifest = JSON.parse(sourceText(blob(repoRoot, finalEntries.get(FREEZE_V2_PATHS.preCandidateFreeze)!.oid, env)));
    if (canonical(finalManifest) !== canonical(manifest) || canonical(inventoryExecutableClosureAtCommit(repoRoot, finalTree, FREEZE_V2_ENTRYPOINTS, env)) !== canonical(initialRows)) throw new Error('FREEZE_PREPARATION_TREE_INVALID');
    const exactCommitPaths = String(git(repoRoot, ['diff', '--name-only', '--no-renames', baseCommitSha, finalTree], 'utf8', env)).trim().split(/\r?\n/).filter(Boolean);
    return {baseCommitSha, futureTreeSha: finalTree, exactCommitPaths, preCandidateFreezeSha256: sha256(blob(repoRoot, finalEntries.get(FREEZE_V2_PATHS.preCandidateFreeze)!.oid, env)),
      manifest, closure: closureDocument, realIndexChanged: false};
  } finally {
    const finalIndex = existsSync(resolvedIndexPath) ? readFileSync(resolvedIndexPath) : undefined;
    if ((initialIndex === undefined) !== (finalIndex === undefined) || (initialIndex && finalIndex && !initialIndex.equals(finalIndex))) throw new Error('FREEZE_REAL_INDEX_CHANGED');
    rmSync(tempRoot, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
  }
}

export const FREEZE_V2_REQUIRED_MATRIX_IDS = REQUIRED_MATRIX_IDS;
export const FREEZE_V2_SUPPORT_PATHS = SUPPORT;
export const FREEZE_V2_PREPARATION_PATHS = [FREEZE_V2_PATHS.supersession, FREEZE_V2_PATHS.generationContractSupersession, FREEZE_V2_PATHS.authorityMatrix,
  FREEZE_V2_PATHS.closureSchema, FREEZE_V2_PATHS.manifestSchema, FREEZE_V2_PATHS.authorityMatrixSchema,
  FREEZE_V2_PATHS.generationEvidenceSchema,
  FREEZE_V2_PATHS.prepareScript, FREEZE_V2_PATHS.authorityTests, FREEZE_V2_PATHS.generatorTests,
  FREEZE_V2_PATHS.controlledProfileTests, FREEZE_V2_PATHS.protocolDocumentation, FREEZE_V2_PATHS.trustedRunnerBootstrap, FREEZE_V2_PATHS.trustedRunnerTests,
  FREEZE_V2_PATHS.trustedRunnerEntrypoint,
  'src/benchmark/controlled-candidate-generator.ts', 'src/benchmark/freeze-authority-v2.ts'];
