import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical} from '../src/oracle/canonical.ts';
import {CONTROL_PATHS, EXECUTABLE_ROOTS, generateControlledCandidate, hashInventoryRows, inventoryDependencyV1, inventoryExecutableClosure, inventorySourceV1, noExistingOutput,
  loadFrozenControls, normalizeBuildBanner, reproduceBuildTwice, sha256, validateSingleCaseBinding, verifyControlledCandidate} from '../src/benchmark/controlled-candidate-generator.ts';
import {FREEZE_V2_ENTRYPOINTS, FREEZE_V2_PATHS, FREEZE_V2_SUPPORT_PATHS, prepareFreezeAuthorityV2} from '../src/benchmark/freeze-authority-v2.ts';
import {assertControlledCandidateLifecycle, CANDIDATE_ARTIFACT_COMMIT, GENERATION_AUTHORITY_COMMIT} from './controlled-candidate-lifecycle.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const rowsHash = (rows: unknown) => digest(canonical(rows));
const testBuild = (_sourceRoot: string) => ({
  'index.js': Buffer.from('/* node-cache 4.0.0 ( 2020-01-02 ) */\nindex\n'),
  'lib/node_cache.js': Buffer.from('/* node-cache 4.0.0 ( 2020-01-02 ) */\ncache\n'),
});

function fixture() {
  const fixtureRoot = path.join(root, '.tmp-cat-freeze-fixtures');
  mkdirSync(fixtureRoot, {recursive: true});
  const repoRoot = mkdtempSync(path.join(fixtureRoot, '.cat-freeze-git-'));
  const put = (relative: string, value: string | Buffer) => {
    const target = path.join(repoRoot, relative); mkdirSync(path.dirname(target), {recursive: true}); writeFileSync(target, value);
  };
  const baseRoot = path.join(repoRoot, 'fixtures/base');
  put('fixtures/base/_src/lib/node_cache.coffee', 'if ttl >= 0\n  keep\n');
  put('fixtures/base/Gruntfile.coffee', 'grunt build\n');
  put('fixtures/base/index.js', 'base index\n');
  put('fixtures/base/lib/node_cache.js', 'base runtime\n');
  put('fixtures/base/package.json', '{}\n');
  const baseRows = inventorySourceV1(baseRoot);
  const sourceFile = path.join(baseRoot, '_src/lib/node_cache.coffee');
  const dependencyRoot = path.join(repoRoot, 'suite/node_modules');
  put('suite/node_modules/grunt-cli/bin/grunt', 'grunt-cli\n');
  put('suite/node_modules/grunt/lib/grunt.js', 'grunt\n');
  put('suite/node_modules/coffee-script/lib/coffee-script/coffee-script.js', 'coffee\n');
  const dependencyRows = inventoryDependencyV1(dependencyRoot);
  put('suite/package-lock.json', '{"lockfileVersion":3}\n');
  const lockSha256 = digest(readFileSync(path.join(repoRoot, 'suite/package-lock.json')));
  const depSha256 = rowsHash(dependencyRows);
  const build = {contractVersion: 'ControlledBuildContractV1', sourceRoot: 'fixtures/base', workingDirectory: '.',
    command: ['node', 'node_modules/grunt-cli/bin/grunt', 'build', '--no-color'],
    runtime: {containerImageDigest: 'sha256:' + 'c'.repeat(64), nodeVersion: 'v22.23.2'},
    dependency: {inventoryVersion: 'DependencyInventoryV1', root: 'suite/node_modules', identitySha256: depSha256,
      lockfilePath: 'suite/package-lock.json', lockfileSha256: lockSha256, gruntCliPath: 'grunt-cli/bin/grunt',
      gruntCliSha256: digest('grunt-cli\n'), gruntEntrypointPath: 'grunt/lib/grunt.js', gruntEntrypointSha256: digest('grunt\n'),
      coffeeScriptVersion: '1.3.3', coffeeScriptCompilerPath: 'coffee-script/lib/coffee-script/coffee-script.js',
      coffeeScriptCompilerSha256: digest('coffee\n')},
    execution: {network: 'none', pull: 'never', readOnlyRoot: true, containerUser: '10001:10001', capDrop: ['ALL'],
      noNewPrivileges: true, pidsLimit: 64, memoryLimit: '256m', cpuLimit: 1, temporaryFilesystem: '/tmp:rw,noexec,nosuid,size=32m',
      sourceMount: 'read-write-temporary-copy', dependencyMount: 'read-only'},
    expectedRuntimeFiles: ['index.js', 'lib/node_cache.js'],
    bannerNormalization: {version: 'BannerDateOnlyV1', frozenDate: '2020-01-01', prefix: 'node-cache 4.0.0 ( ', suffix: ' )',
      datePattern: '[0-9]{4}-[0-9]{2}-[0-9]{2}', expectedMatchCounts: {'index.js': 1, 'lib/node_cache.js': 1}, onlyGeneratedBannerDateMayChange: true}};
  const spec = {specVersion: 'ControlledMutationSpecV1', caseId: 'node-cache-ttl-zero-001', behavioralClass: 'TTL_ZERO_DELETES_EXISTING_ENTRY',
    baseSourceRoot: 'fixtures/base', sourcePath: '_src/lib/node_cache.coffee', baseFileSha256: digest(readFileSync(sourceFile)),
    transform: {kind: 'exact-utf8-text-replacement', oldText: 'if ttl >= 0', newText: 'if ttl > 0', matchCount: 1},
    allowedChangedSourcePaths: ['_src/lib/node_cache.coffee'], alternatives: [], fallbacks: [], outcomeBasedSelection: 'PROHIBITED'};
  const profile: any = {profileVersion: 'ControlledBenchmarkSubjectProfileV1', caseId: spec.caseId, status: 'READY_FOR_OWNER_FREEZE_REVIEW',
    maliciousCodeIsolationClaim: false, arbitraryExternalSubjectSupport: 'NOT_APPROVED', candidateCreated: false, competitiveLanesExecuted: false,
    candidateId: 'synthetic-controlled-v1', candidateBundleRoot: 'candidate/bundle', candidateSourceRoot: 'candidate/bundle/source', candidateRoot: 'candidate/bundle/runtime',
    reproductionSourceRoot: 'candidate/bundle/reproduction/source', reproductionRuntimeRoot: 'candidate/bundle/reproduction/runtime',
    acceptanceMatrixPath: 'benchmark/protocol/controlled-profile-acceptance-matrix-v1.json', controlledProfileRequirements: [],
    base: {sourceRoot: 'fixtures/base', sourceTreeFileCount: baseRows.length, sourceTreeSha256: rowsHash(baseRows), sourceTree: baseRows},
    dependencyIdentity: {root: 'suite/node_modules', inventoryVersion: 'DependencyInventoryV1', fileCount: dependencyRows.length,
      inventorySha256: depSha256, lockfileSha256: lockSha256},
    controlledExecutionInfrastructureV2: {identityVersion: 'ExecutionInfrastructureIdentityV2', nodeRuntimeVersion: 'v22.23.2',
      containerImageDigest: build.runtime.containerImageDigest, subjectAdapterPath: CONTROL_PATHS.subjectAdapter,
      subjectAdapterSha256: digest(readFileSync(path.join(root, CONTROL_PATHS.subjectAdapter))), executorPath: CONTROL_PATHS.subjectExecutor,
      executorSha256: digest(readFileSync(path.join(root, CONTROL_PATHS.subjectExecutor))), buildContractSha256: digest(JSON.stringify(build)), identitySha256: '0'.repeat(64)}};
  const infra = {...profile.controlledExecutionInfrastructureV2}; delete infra.identitySha256;
  profile.controlledExecutionInfrastructureV2.identitySha256 = rowsHash(infra);
  const protocol = {protocolVersion: 'SingleCaseProtocolV2', challengeId: spec.caseId};
  const files: Record<string, string> = {
    [CONTROL_PATHS.profile]: 'benchmark/protocol/controlled-subject-profile-v1.json',
    [CONTROL_PATHS.acceptanceMatrix]: 'benchmark/protocol/controlled-profile-acceptance-matrix-v1.json',
    [CONTROL_PATHS.mutationSpec]: 'benchmark/protocol/controlled-mutation-spec-v1.json',
    [CONTROL_PATHS.buildContract]: 'benchmark/protocol/controlled-build-contract-v1.json',
    [CONTROL_PATHS.sameCandidateProtocol]: 'benchmark/protocol/single-case-v2.json',
    [CONTROL_PATHS.challengeSchema]: 'benchmark/schemas/controlled-challenge-manifest-v1.schema.json',
    [CONTROL_PATHS.generationEvidenceSchema]: 'benchmark/schemas/controlled-generation-evidence-v1.schema.json',
    [CONTROL_PATHS.profileSchema]: 'benchmark/schemas/controlled-subject-profile-v1.schema.json',
    [CONTROL_PATHS.receiptSchema]: 'benchmark/schemas/controlled-benchmark-subject-receipt-v1.schema.json',
    [CONTROL_PATHS.singleCaseResultSchema]: 'benchmark/schemas/single-case-result-v1.schema.json',
  };
  const matrixBytes = JSON.stringify({controlledProfileRequirements: []});
  put(files[CONTROL_PATHS.acceptanceMatrix], matrixBytes);
  profile.acceptanceMatrixSha256 = digest(matrixBytes);
  put(files[CONTROL_PATHS.profile], JSON.stringify(profile));
  put(files[CONTROL_PATHS.mutationSpec], JSON.stringify(spec));
  put(files[CONTROL_PATHS.buildContract], JSON.stringify(build));
  put(files[CONTROL_PATHS.sameCandidateProtocol], JSON.stringify(protocol));
  put(files[CONTROL_PATHS.challengeSchema], 'challenge schema fixture');
  put(files[CONTROL_PATHS.generationEvidenceSchema], 'evidence schema fixture');
  put(files[CONTROL_PATHS.profileSchema], 'profile schema fixture');
  put(files[CONTROL_PATHS.receiptSchema], 'receipt schema fixture');
  put(files[CONTROL_PATHS.singleCaseResultSchema], 'single-case result schema fixture');
  const executableRows = inventoryExecutableClosure(root);
  for (const row of executableRows) put(row.path, readFileSync(path.join(root, row.path)));
  put(CONTROL_PATHS.executableClosure, JSON.stringify({version: 'FreezeExecutableClosureV1', rows: executableRows}, null, 2) + '\n');
  files[CONTROL_PATHS.executableClosure] = CONTROL_PATHS.executableClosure;
  const artifacts = Object.fromEntries(Object.entries(files).map(([filePath, workingPath]) => [filePath, digest(readFileSync(path.join(repoRoot, workingPath)))]));
  const manifest = {manifestVersion: 'PreCandidateFreezeV1', status: 'READY_FOR_OWNER_FREEZE_COMMIT', futureAnchor: 'freezeCommitSha', artifacts,
    executableClosureVersion: 'FreezeExecutableClosureV1', executableClosureSha256: rowsHash(executableRows),
    profileSha256: artifacts[CONTROL_PATHS.profile], mutationSpecSha256: artifacts[CONTROL_PATHS.mutationSpec],
    buildContractSha256: artifacts[CONTROL_PATHS.buildContract], sameCandidateProtocolSha256: artifacts[CONTROL_PATHS.sameCandidateProtocol],
    acceptanceMatrixSha256: artifacts[CONTROL_PATHS.acceptanceMatrix],
    dependencyIdentityVersion: 'DependencyInventoryV1', dependencyIdentitySha256: depSha256, dependencyLockSha256: lockSha256,
    executionInfrastructureIdentitySha256: profile.controlledExecutionInfrastructureV2.identitySha256,
    generatorSourceIdentitySha256: rowsHash(executableRows),
    controlledGateSourceIdentitySha256: rowsHash(executableRows),
    sameCandidateContractSha256: artifacts[CONTROL_PATHS.sameCandidateProtocol]};
  put(CONTROL_PATHS.preCandidateFreeze, JSON.stringify(manifest));
  execFileSync('git', ['-C', repoRoot, 'init', '--quiet']);
  execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 'CAT Synthetic Test']);
  execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 'cat-test@example.invalid']);
  execFileSync('git', ['-C', repoRoot, 'config', 'core.autocrlf', 'false']);
  execFileSync('git', ['-C', repoRoot, 'add', '.']);
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'synthetic freeze', '--quiet']);
  const v1FreezeCommitSha = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  const v2Support = FREEZE_V2_SUPPORT_PATHS.filter((filePath) => filePath !== FREEZE_V2_PATHS.preCandidateFreeze && filePath !== FREEZE_V2_PATHS.executableClosure);
  const v2ExecutableRows = inventoryExecutableClosure(root, FREEZE_V2_ENTRYPOINTS);
  for (const row of v2ExecutableRows) {
    if (existsSync(path.join(repoRoot, row.path))) continue;
    put(row.path, readFileSync(path.join(root, row.path)));
  }
  for (const filePath of v2Support) {
    if (existsSync(path.join(repoRoot, filePath))) continue;
    put(filePath, readFileSync(path.join(root, filePath)));
  }
  const v2Allowlist = [...new Set([...v2ExecutableRows.map((row) => row.path), ...v2Support])];
  prepareFreezeAuthorityV2(repoRoot, v1FreezeCommitSha, v2Allowlist);
  execFileSync('git', ['-C', repoRoot, 'add', '.']);
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'synthetic V2 freeze authority', '--quiet']);
  const freezeCommitSha = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  const adapter = (source: string) => {
    const sourceBytes = readFileSync(path.join(source, spec.sourcePath));
    const body = sourceBytes.toString('utf8');
    const banner = '/* node-cache 4.0.0 ( 2020-01-02 ) */\n';
    return {'index.js': Buffer.from(banner + body), 'lib/node_cache.js': Buffer.from(banner + body)};
  };
  return {repoRoot, profile, spec, build, freezeCommitSha, v1FreezeCommitSha, baseRoot, dependencyRoot, adapter,
    cleanup: () => {
      if (process.platform !== 'win32') return rmSync(repoRoot, {recursive: true, force: true, maxRetries: 80, retryDelay: 250});
      const quoted = repoRoot.replaceAll("'", "''");
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `for ($i=0; $i -lt 30 -and (Test-Path -LiteralPath '${quoted}'); $i++) { try { Remove-Item -LiteralPath '${quoted}' -Recurse -Force -ErrorAction Stop } catch { Start-Sleep -Milliseconds 250 } }; if (Test-Path -LiteralPath '${quoted}') { exit 1 }`], {stdio: 'ignore'});
    }};
}

test('mutation has exact preimage, replacement, one match and deletion semantics without result leakage', () => {
  const spec = JSON.parse(readFileSync(path.join(root, 'benchmark/protocol/controlled-mutation-spec-v1.json'), 'utf8'));
  const base = readFileSync(path.join(root, spec.baseSourceRoot, spec.sourcePath), 'utf8');
  assert.equal(spec.behavioralClass, 'TTL_ZERO_DELETES_EXISTING_ENTRY');
  assert.equal(spec.transform.oldText, 'if ttl >= 0');
  assert.equal(spec.transform.newText, 'if ttl > 0');
  assert.equal(spec.transform.matchCount, 1);
  assert.equal(base.split(spec.transform.oldText).length - 1, 1);
  assert.deepEqual(spec.alternatives, []);
  assert.deepEqual(spec.fallbacks, []);
  assert.equal(Object.keys(spec).some((key) => /expected(?:Decision|Result|Winner|Score|B[0-4])/i.test(key)), false);
  assert.equal(JSON.stringify(spec).includes('EXPIRES'), false);
  const docs = readFileSync(path.join(root, 'docs/BENCHMARK_PROTOCOL.md'), 'utf8');
  assert.match(docs, /zero-TTL branch reaches `del\(\)`/);
  assert.match(docs, /deletion-related cache statistics/);
  assert.match(docs, /existing `del` event/);
  assert.match(docs, /preserves the existing value without expiry; the controlled specimen deletes it/);
});

test('ControlledBuildContractV1 pins build, runtime, dependencies, banner and outputs', () => {
  const contract = JSON.parse(readFileSync(path.join(root, 'benchmark/protocol/controlled-build-contract-v1.json'), 'utf8'));
  assert.equal(contract.contractVersion, 'ControlledBuildContractV1');
  assert.equal(contract.sourceRoot, 'fixtures/hero/node-cache-ttl-zero-001/upstream/4.0.0');
  assert.equal(contract.workingDirectory, '.');
  assert.deepEqual(contract.command, ['node', 'node_modules/grunt-cli/bin/grunt', 'build', '--no-color']);
  assert.equal(contract.runtime.nodeVersion, 'v22.23.2');
  assert.match(contract.runtime.containerImageDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(contract.execution.network, 'none');
  assert.equal(contract.dependency.inventoryVersion, 'DependencyInventoryV1');
  assert.equal(contract.dependency.lockfileSha256, '21c448532a8e400504c800df67ad246d6d9461c7883fc7e68861d3960ebc3ce8');
  assert.equal(contract.dependency.gruntCliSha256, sha256File(path.join(root, 'fixtures/hero/node-cache-ttl-zero-001/suite/node_modules/grunt-cli/bin/grunt')));
  assert.equal(contract.dependency.gruntEntrypointSha256, sha256File(path.join(root, 'fixtures/hero/node-cache-ttl-zero-001/suite/node_modules/grunt/lib/grunt.js')));
  assert.equal(contract.dependency.coffeeScriptCompilerSha256, sha256File(path.join(root, 'fixtures/hero/node-cache-ttl-zero-001/suite/node_modules/coffee-script/lib/coffee-script/coffee-script.js')));
  assert.deepEqual(contract.expectedRuntimeFiles, ['index.js', 'lib/node_cache.js']);
  assert.equal(contract.bannerNormalization.frozenDate, '2026-10-06');
  assert.equal(contract.bannerNormalization.version, 'BannerDateOnlyV1');
  assert.deepEqual(contract.bannerNormalization.expectedMatchCounts, {'index.js': 1, 'lib/node_cache.js': 1});
  const profile = JSON.parse(readFileSync(path.join(root, 'benchmark/protocol/controlled-subject-profile-v1.json'), 'utf8'));
  const infra = {...profile.controlledExecutionInfrastructureV2}; delete infra.identitySha256;
  assert.equal(rowsHash(infra), profile.controlledExecutionInfrastructureV2.identitySha256);
  assert.equal(profile.controlledExecutionInfrastructureV2.dependencyInventoryVersion, 'DependencyInventoryV1');
  assert.equal(profile.controlledExecutionInfrastructureV2.dependencyIdentitySha256, profile.dependencyIdentity.inventorySha256);
  assert.equal(profile.controlledExecutionInfrastructureV2.dependencyLockSha256, profile.dependencyIdentity.lockfileSha256);
  assert.equal(profile.controlledExecutionInfrastructureV2.containerImageDigest, contract.runtime.containerImageDigest);
});

function sha256File(file: string) { return digest(readFileSync(file)); }

test('banner normalization changes one date field only and rejects zero or multiple matches', () => {
  const contract = JSON.parse(readFileSync(path.join(root, 'benchmark/protocol/controlled-build-contract-v1.json'), 'utf8'));
  const input = Buffer.from('/* node-cache 4.0.0 ( 2020-01-02 ) */\nKEEP\n');
  const output = normalizeBuildBanner(input, 'index.js', contract);
  assert.equal(output.toString('utf8'), '/* node-cache 4.0.0 ( 2026-10-06 ) */\nKEEP\n');
  assert.throws(() => normalizeBuildBanner(Buffer.from('none'), 'index.js', contract), /BUILD_BANNER_MATCH_COUNT_INVALID/);
  assert.throws(() => normalizeBuildBanner(Buffer.from(input.toString() + input.toString()), 'index.js', contract), /BUILD_BANNER_MATCH_COUNT_INVALID/);
});

test('DependencyInventoryV1 recomputes canonical installed dependency identity', () => {
  const profile = JSON.parse(readFileSync(path.join(root, 'benchmark/protocol/controlled-subject-profile-v1.json'), 'utf8'));
  const dependencyRoot = path.join(root, profile.dependencyIdentity.root);
  const first = inventoryDependencyV1(dependencyRoot), second = inventoryDependencyV1(dependencyRoot);
  assert.equal(first.length, profile.dependencyIdentity.fileCount);
  assert.equal(rowsHash(first), profile.dependencyIdentity.inventorySha256);
  assert.deepEqual(first, second);
  assert.ok(first.every((row, index) => !row.path.includes('\\') && (!index || first[index - 1].path < row.path)));
  assert.equal(profile.dependencyIdentity.inventoryVersion, 'DependencyInventoryV1');
});

test('unmodified base builds twice identically after banner normalization', async () => {
  const contract = JSON.parse(readFileSync(path.join(root, 'benchmark/protocol/controlled-build-contract-v1.json'), 'utf8'));
  const sourceRoot = path.join(root, contract.sourceRoot), dependencyRoot = path.join(root, contract.dependency.root);
  const result = await reproduceBuildTwice(sourceRoot, dependencyRoot, contract);
  assert.equal(result.rows.length, 2);
  assert.equal(result.runtimeCandidateHash, rowsHash(result.rows));
  assert.equal(result.reproductionRuntimeCandidateHash, rowsHash(result.reproductionRows));
  assert.deepEqual(result.rows, result.reproductionRows);
  assert.deepEqual(result.rows.map((row) => row.path), contract.expectedRuntimeFiles);
});

test('full freeze commit SHA rejects mutable worktree replacements and stale committed controls', () => {
  const f = fixture();
  try {
    assert.throws(() => loadFrozenControls(f.repoRoot, ''), /FREEZE_COMMIT_SHA_REQUIRED/);
    const committed = loadFrozenControls(f.repoRoot, f.freezeCommitSha);
    assert.equal(committed.freezeCommitSha, f.freezeCommitSha);
    const profilePath = path.join(f.repoRoot, 'benchmark/protocol/controlled-subject-profile-v1.json');
    const original = readFileSync(profilePath);
    writeFileSync(profilePath, '{}');
    assert.throws(() => loadFrozenControls(f.repoRoot, f.freezeCommitSha), /FREEZE_WORKTREE_ARTIFACT_MISMATCH/);
    writeFileSync(profilePath, original);
    const matrixPath = path.join(f.repoRoot, 'benchmark/protocol/controlled-profile-acceptance-matrix-v1.json');
    writeFileSync(matrixPath, JSON.stringify({controlledProfileRequirements: [{id: 'edited'}]}));
    execFileSync('git', ['-C', f.repoRoot, 'add', 'benchmark/protocol/controlled-subject-profile-v1.json']);
    execFileSync('git', ['-C', f.repoRoot, 'add', 'benchmark/protocol/controlled-profile-acceptance-matrix-v1.json']);
    execFileSync('git', ['-C', f.repoRoot, 'commit', '-m', 'unanchored edit', '--quiet']);
    const editedCommit = execFileSync('git', ['-C', f.repoRoot, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
    assert.throws(() => loadFrozenControls(f.repoRoot, editedCommit), /FREEZE_ARTIFACT_HASH_MISMATCH/);
  } finally { f.cleanup(); }
});

test('FreezeExecutableClosureV1 binds transitive local imports and keeps builtins and fixture dependencies separate', () => {
  const f = fixture();
  try {
    const controls = loadFrozenControls(f.repoRoot, f.freezeCommitSha);
    const rows = JSON.parse(controls.bytes[CONTROL_PATHS.executableClosure].toString('utf8')).rows;
    assert.ok(rows.some((row: any) => row.path === 'src/oracle/canonical.ts'));
    assert.deepEqual(rows, inventoryExecutableClosure(f.repoRoot, EXECUTABLE_ROOTS));
    assert.equal(rows.some((row: any) => row.path.includes('node_modules/')), false);
    assert.equal(rows.some((row: any) => row.path.startsWith('node:')), false);
    assert.ok(inventoryDependencyV1(path.join(f.repoRoot, 'suite/node_modules')).some((row) => row.path === 'grunt-cli/bin/grunt'));
    assert.equal(controls.manifest.generatorSourceIdentitySha256, controls.manifest.executableClosureSha256);
    assert.equal(controls.manifest.controlledGateSourceIdentitySha256, controls.manifest.executableClosureSha256);
  } finally { f.cleanup(); }
});

test('transitive local module mutation and deletion reject controlled generation and gate before execution', async () => {
  for (const mode of ['modify', 'delete'] as const) {
    const f = fixture();
    try {
      const modulePath = path.join(f.repoRoot, 'src/oracle/canonical.ts');
      if (mode === 'modify') writeFileSync(modulePath, readFileSync(modulePath, 'utf8') + '\n// changed\n');
      else rmSync(modulePath);
      await assert.rejects(() => generateControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha,
        outputDirectory: path.join(f.repoRoot, f.profile.candidateBundleRoot), buildAdapter: f.adapter}), /FREEZE_WORKTREE_(FILE_INVALID|MUTATION_REJECTED)/);
      await assert.rejects(() => verifyControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha,
        sourceRoot: '', runtimeRoot: '', manifestPath: '', generationEvidencePath: '', challengeManifestPath: ''}), /FREEZE_WORKTREE_(FILE_INVALID|MUTATION_REJECTED)/);
    } finally { f.cleanup(); }
  }
});

test('unresolved local dynamic imports fail closed', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'cat-unresolved-closure-'));
  try {
    writeFileSync(path.join(temp, 'entry.ts'), "const name = './part'; await import(name);\n");
    assert.throws(() => inventoryExecutableClosure(temp, ['entry.ts']), /FREEZE_CODE_CLOSURE_UNRESOLVED/);
  } finally { rmSync(temp, {recursive: true, force: true}); }
});

test('frozen candidate output path is reachable and alternates or existing output reject', () => {
  const f = fixture();
  try {
    const expected = noExistingOutput(f.repoRoot, f.profile.candidateBundleRoot, f.profile.candidateBundleRoot);
    assert.equal(expected, path.resolve(f.repoRoot, f.profile.candidateBundleRoot));
    assert.throws(() => noExistingOutput(f.repoRoot, f.profile.candidateBundleRoot, 'candidate/alternate'), /CONTROLLED_OUTPUT_PATH_REJECTED/);
    mkdirSync(expected, {recursive: true});
    assert.throws(() => noExistingOutput(f.repoRoot, f.profile.candidateBundleRoot, f.profile.candidateBundleRoot), /CONTROLLED_OUTPUT_PATH_REJECTED/);
  } finally { f.cleanup(); }
});

test('synthetic generator verifies exact delta, reproduces, and emits evidence without using DP05 bytes', async () => {
  const f = fixture();
  const outputRoot = path.join(f.repoRoot, 'candidate/bundle');
  try {
    const generated = await generateControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha, outputDirectory: outputRoot, buildAdapter: f.adapter});
    assert.ok(existsSync(path.join(outputRoot, 'source/_src/lib/node_cache.coffee')));
    assert.ok(existsSync(path.join(outputRoot, 'reproduction/source/_src/lib/node_cache.coffee')));
    assert.ok(existsSync(path.join(outputRoot, 'reproduction/runtime/index.js')));
    assert.equal(generated.sourceCandidateHash, hashInventoryRows(inventorySourceV1(path.join(outputRoot, 'source'))));
    assert.equal(generated.runtimeCandidateHash, hashInventoryRows(inventorySourceV1(path.join(outputRoot, 'runtime'))));
    const evidence = JSON.parse(readFileSync(path.join(outputRoot, 'generation-evidence.json'), 'utf8'));
    assert.equal(evidence.evidenceVersion, 'ControlledGenerationEvidenceV2');
    assert.equal(evidence.reproducibility.derivationCount, 2);
    assert.deepEqual(evidence.reproducibility.primary, evidence.reproducibility.reproduction);
    assert.deepEqual(readdirSync(outputRoot).sort(), ['challenge-manifest.json', 'generation-evidence.json', 'manifest.json', 'reproduction', 'runtime', 'source']);
    assert.equal(JSON.parse(readFileSync(path.join(outputRoot, 'challenge-manifest.json'), 'utf8')).freezeCommitSha, f.freezeCommitSha);
  } finally { f.cleanup(); }
});

test('ControlledGenerationEvidenceV2 schema and verifier enforce both derivations instead of trusting claims', async () => {
  const f = fixture(), output = path.join(f.repoRoot, 'candidate/bundle');
  try {
    const schema = JSON.parse(readFileSync(path.join(root, 'benchmark/schemas/controlled-generation-evidence-v2.schema.json'), 'utf8'));
    assert.equal(schema.$id, 'ControlledGenerationEvidenceV2');
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.reproducibility.additionalProperties, false);
    assert.equal(schema.$defs.derivation.additionalProperties, false);
    await generateControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha, outputDirectory: output, buildAdapter: f.adapter});
    const options = {repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha, sourceRoot: path.join(output, 'source'),
      runtimeRoot: path.join(output, 'runtime'), manifestPath: path.join(output, 'manifest.json'),
      generationEvidencePath: path.join(output, 'generation-evidence.json'), challengeManifestPath: path.join(output, 'challenge-manifest.json'), buildAdapter: f.adapter};
    const verified = await verifyControlledCandidate(options);
    const evidence = JSON.parse(readFileSync(options.generationEvidencePath, 'utf8'));
    assert.equal(verified.sourceCandidateHash, evidence.sourceCandidateHash);
    evidence.reproducibility.sourceByteEquivalent = false;
    delete evidence.generationEvidenceSha256;
    evidence.generationEvidenceSha256 = rowsHash(evidence);
    writeFileSync(options.generationEvidencePath, JSON.stringify(evidence));
    const challenge = JSON.parse(readFileSync(options.challengeManifestPath, 'utf8'));
    challenge.generationEvidenceSha256 = evidence.generationEvidenceSha256;
    writeFileSync(options.challengeManifestPath, JSON.stringify(challenge));
    await assert.rejects(() => verifyControlledCandidate(options), /CONTROLLED_GENERATION_BINDING_INVALID/);
  } finally { f.cleanup(); }
});

test('V2 verifier rejects a mutated persisted reproduction source', async () => {
  const f = fixture(), output = path.join(f.repoRoot, 'candidate/bundle');
  try {
    await generateControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha, outputDirectory: output, buildAdapter: f.adapter});
    writeFileSync(path.join(output, 'reproduction/source/_src/lib/node_cache.coffee'), 'if ttl > 0\n  forged reproduction\n');
    await assert.rejects(() => verifyControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha,
      sourceRoot: path.join(output, 'source'), runtimeRoot: path.join(output, 'runtime'), manifestPath: path.join(output, 'manifest.json'),
      generationEvidencePath: path.join(output, 'generation-evidence.json'), challengeManifestPath: path.join(output, 'challenge-manifest.json'), buildAdapter: f.adapter}),
    /CONTROLLED_(SOURCE_DELTA|GENERATION_BINDING)_INVALID/);
  } finally { f.cleanup(); }
});

test('V2 verifier rejects a forged derivation identity with repaired outer evidence hash', async () => {
  const f = fixture(), output = path.join(f.repoRoot, 'candidate/bundle');
  try {
    await generateControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha, outputDirectory: output, buildAdapter: f.adapter});
    const evidencePath = path.join(output, 'generation-evidence.json'), challengePath = path.join(output, 'challenge-manifest.json');
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    evidence.reproducibility.primary.derivationIdentitySha256 = '0'.repeat(64);
    delete evidence.generationEvidenceSha256;
    evidence.generationEvidenceSha256 = rowsHash(evidence);
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const challenge = JSON.parse(readFileSync(challengePath, 'utf8'));
    challenge.generationEvidenceSha256 = evidence.generationEvidenceSha256;
    writeFileSync(challengePath, JSON.stringify(challenge));
    const evidenceProjection = {...evidence};
    delete evidenceProjection.generationEvidenceSha256;
    assert.equal(evidence.generationEvidenceSha256, rowsHash(evidenceProjection));
    await assert.rejects(() => verifyControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha,
      sourceRoot: path.join(output, 'source'), runtimeRoot: path.join(output, 'runtime'), manifestPath: path.join(output, 'manifest.json'),
      generationEvidencePath: evidencePath, challengeManifestPath: challengePath, buildAdapter: f.adapter}), /CONTROLLED_GENERATION_BINDING_INVALID/);
  } finally { f.cleanup(); }
});

test('V2 verifier rejects forged source rows and hash with repaired derivation and outer hashes', async () => {
  const f = fixture(), output = path.join(f.repoRoot, 'candidate/bundle');
  try {
    await generateControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha, outputDirectory: output, buildAdapter: f.adapter});
    const evidencePath = path.join(output, 'generation-evidence.json'), challengePath = path.join(output, 'challenge-manifest.json');
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')), primary = evidence.reproducibility.primary;
    primary.sourceRows[0].sha256 = 'a'.repeat(64);
    primary.sourceCandidateHash = hashInventoryRows(primary.sourceRows);
    primary.derivationIdentitySha256 = rowsHash({sourceRows: primary.sourceRows, sourceCandidateHash: primary.sourceCandidateHash,
      changeBindings: primary.changeBindings, runtimeRows: primary.runtimeRows, runtimeCandidateHash: primary.runtimeCandidateHash});
    delete evidence.generationEvidenceSha256;
    evidence.generationEvidenceSha256 = rowsHash(evidence);
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const challenge = JSON.parse(readFileSync(challengePath, 'utf8'));
    challenge.generationEvidenceSha256 = evidence.generationEvidenceSha256;
    writeFileSync(challengePath, JSON.stringify(challenge));
    await assert.rejects(() => verifyControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha,
      sourceRoot: path.join(output, 'source'), runtimeRoot: path.join(output, 'runtime'), manifestPath: path.join(output, 'manifest.json'),
      generationEvidencePath: evidencePath, challengeManifestPath: challengePath, buildAdapter: f.adapter}), /CONTROLLED_GENERATION_BINDING_INVALID/);
  } finally { f.cleanup(); }
});

test('V2 verifier rejects forged runtime rows and hash with repaired derivation and outer hashes', async () => {
  const f = fixture(), output = path.join(f.repoRoot, 'candidate/bundle');
  try {
    await generateControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha, outputDirectory: output, buildAdapter: f.adapter});
    const evidencePath = path.join(output, 'generation-evidence.json'), challengePath = path.join(output, 'challenge-manifest.json');
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')), primary = evidence.reproducibility.primary;
    primary.runtimeRows[0].sha256 = 'b'.repeat(64);
    primary.runtimeCandidateHash = hashInventoryRows(primary.runtimeRows);
    primary.derivationIdentitySha256 = rowsHash({sourceRows: primary.sourceRows, sourceCandidateHash: primary.sourceCandidateHash,
      changeBindings: primary.changeBindings, runtimeRows: primary.runtimeRows, runtimeCandidateHash: primary.runtimeCandidateHash});
    delete evidence.generationEvidenceSha256;
    evidence.generationEvidenceSha256 = rowsHash(evidence);
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const challenge = JSON.parse(readFileSync(challengePath, 'utf8'));
    challenge.generationEvidenceSha256 = evidence.generationEvidenceSha256;
    writeFileSync(challengePath, JSON.stringify(challenge));
    await assert.rejects(() => verifyControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha,
      sourceRoot: path.join(output, 'source'), runtimeRoot: path.join(output, 'runtime'), manifestPath: path.join(output, 'manifest.json'),
      generationEvidencePath: evidencePath, challengeManifestPath: challengePath, buildAdapter: f.adapter}), /CONTROLLED_GENERATION_BINDING_INVALID/);
  } finally { f.cleanup(); }
});

test('separate base derivations reject source and runtime divergence before bundle persistence', async () => {
  for (const kind of ['source', 'runtime'] as const) {
    const f = fixture(), output = path.join(f.repoRoot, 'candidate/bundle');
    try {
      let calls = 0;
      const adapter = (source: string) => {
        calls++;
        if (kind === 'source' && calls === 1) writeFileSync(path.join(f.baseRoot, f.spec.sourcePath), 'if ttl >= 0\n  changed base\n');
        const built = f.adapter(source);
        if (kind === 'runtime' && calls > 2) return Object.fromEntries(Object.entries(built).map(([name, bytes]) => [name,
          Buffer.concat([bytes, Buffer.from('\nreproduction')])]));
        return built;
      };
      const failure = kind === 'source' ? /CONTROLLED_BASE_TREE_MISMATCH/ : /CONTROLLED_RUNTIME_GENERATION_NOT_REPRODUCIBLE/;
      await assert.rejects(() => generateControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha, outputDirectory: output, buildAdapter: adapter}), failure);
      assert.equal(existsSync(output), false);
      assert.equal(readdirSync(path.dirname(output)).some((name) => name.startsWith('bundle.staging-')), false);
    } finally { f.cleanup(); }
  }
});

test('second derivation failure leaves no candidate or staging bundle', async () => {
  const f = fixture(), output = path.join(f.repoRoot, 'candidate/bundle');
  try {
    let calls = 0;
    const adapter = (source: string) => { if (++calls === 3) throw new Error('synthetic second derivation failure'); return f.adapter(source); };
    await assert.rejects(() => generateControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha, outputDirectory: output, buildAdapter: adapter}), /synthetic second derivation failure/);
    assert.equal(calls, 3);
    assert.equal(existsSync(output), false);
    assert.equal(readdirSync(path.dirname(output)).some((name) => name.startsWith('bundle.staging-')), false);
  } finally { f.cleanup(); }
});

test('independent gate rebuild rejects a source/runtime swap even with rewritten self-asserted evidence', async () => {
  const f = fixture();
  const outputRoot = path.join(f.repoRoot, 'candidate/bundle');
  try {
    await generateControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha, outputDirectory: outputRoot, buildAdapter: f.adapter});
    const runtimePath = path.join(outputRoot, 'runtime/index.js'), reproductionRuntimePath = path.join(outputRoot, 'reproduction/runtime/index.js');
    writeFileSync(runtimePath, 'unrelated runtime bytes'); writeFileSync(reproductionRuntimePath, 'unrelated runtime bytes');
    const manifestPath = path.join(outputRoot, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.files.find((row: any) => row.path === 'index.js').sha256 = digest(readFileSync(runtimePath));
    manifest.candidateHash = rowsHash(manifest.files);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const evidencePath = path.join(outputRoot, 'generation-evidence.json');
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    evidence.runtimeCandidateHash = manifest.candidateHash;
    evidence.runtimeManifestSha256 = digest(canonical(manifest));
    for (const [item, runtimeRoot] of [[evidence.reproducibility.primary, path.join(outputRoot, 'runtime')],
      [evidence.reproducibility.reproduction, path.join(outputRoot, 'reproduction/runtime')]] as const) {
      item.runtimeRows = inventorySourceV1(runtimeRoot);
      item.runtimeCandidateHash = hashInventoryRows(item.runtimeRows);
      item.derivationIdentitySha256 = rowsHash({sourceRows: item.sourceRows, sourceCandidateHash: item.sourceCandidateHash,
        changeBindings: item.changeBindings, runtimeRows: item.runtimeRows, runtimeCandidateHash: item.runtimeCandidateHash});
    }
    delete evidence.generationEvidenceSha256;
    evidence.generationEvidenceSha256 = digest(canonical(evidence));
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const challengePath = path.join(outputRoot, 'challenge-manifest.json');
    const challenge = JSON.parse(readFileSync(challengePath, 'utf8'));
    challenge.runtimeCandidateHash = manifest.candidateHash;
    challenge.generationEvidenceSha256 = evidence.generationEvidenceSha256;
    writeFileSync(challengePath, JSON.stringify(challenge));
    await assert.rejects(() => verifyControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha,
      sourceRoot: path.join(outputRoot, 'source'), runtimeRoot: path.join(outputRoot, 'runtime'), manifestPath,
      generationEvidencePath: evidencePath, challengeManifestPath: challengePath, buildAdapter: f.adapter}), /CONTROLLED_SOURCE_RUNTIME_LINK_INVALID/);
  } finally { f.cleanup(); }
});

test('exact delta rejects extra changed path and extra changed bytes', async () => {
  const f = fixture();
  try {
    const output = path.join(f.repoRoot, 'candidate/bundle');
    await generateControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha, outputDirectory: output, buildAdapter: f.adapter});
    const mutated = path.join(output, 'source/_src/lib/node_cache.coffee');
    writeFileSync(mutated, 'if ttl > 0\n  changed unexpectedly\n');
    await assert.rejects(() => verifyControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha,
      sourceRoot: path.join(output, 'source'), runtimeRoot: path.join(output, 'runtime'), manifestPath: path.join(output, 'manifest.json'),
      generationEvidencePath: path.join(output, 'generation-evidence.json'), challengeManifestPath: path.join(output, 'challenge-manifest.json'),
      buildAdapter: f.adapter}), /CONTROLLED_SOURCE_DELTA_INVALID/);
    writeFileSync(mutated, 'if ttl > 0\n  keep\n');
    writeFileSync(path.join(output, 'source/extra.txt'), 'extra');
    await assert.rejects(() => verifyControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha,
      sourceRoot: path.join(output, 'source'), runtimeRoot: path.join(output, 'runtime'), manifestPath: path.join(output, 'manifest.json'),
      generationEvidencePath: path.join(output, 'generation-evidence.json'), challengeManifestPath: path.join(output, 'challenge-manifest.json'),
      buildAdapter: f.adapter}), /CONTROLLED_SOURCE_DELTA_INVALID/);
  } finally { f.cleanup(); }
});

test('an arbitrary manifest and self-asserted evidence cannot enter the controlled path', async () => {
  const f = fixture();
  const output = path.join(f.repoRoot, 'candidate/bundle');
  try {
    await generateControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha, outputDirectory: output, buildAdapter: f.adapter});
    const manifestPath = path.join(output, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); manifest.candidateId = 'arbitrary-external-subject';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const evidencePath = path.join(output, 'generation-evidence.json');
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    evidence.runtimeManifestSha256 = digest(canonical(manifest)); delete evidence.generationEvidenceSha256;
    evidence.generationEvidenceSha256 = digest(canonical(evidence)); writeFileSync(evidencePath, JSON.stringify(evidence));
    const challengePath = path.join(output, 'challenge-manifest.json');
    const challenge = JSON.parse(readFileSync(challengePath, 'utf8')); challenge.generationEvidenceSha256 = evidence.generationEvidenceSha256;
    writeFileSync(challengePath, JSON.stringify(challenge));
    await assert.rejects(() => verifyControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.freezeCommitSha,
      sourceRoot: path.join(output, 'source'), runtimeRoot: path.join(output, 'runtime'), manifestPath,
      generationEvidencePath: evidencePath, challengeManifestPath: challengePath, buildAdapter: f.adapter}), /CONTROLLED_GENERATION_BINDING_INVALID/);
    await assert.rejects(() => verifyControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: '',
      sourceRoot: path.join(output, 'source'), runtimeRoot: path.join(output, 'runtime'), manifestPath,
      generationEvidencePath: evidencePath, challengeManifestPath: challengePath, buildAdapter: f.adapter}), /FREEZE_COMMIT_SHA_REQUIRED/);
  } finally { f.cleanup(); }
});

test('B0, B1, B2 and B4 require the same identity tuple; historical and survivor substitutions are forbidden', () => {
  const protocol = JSON.parse(readFileSync(path.join(root, 'benchmark/protocol/single-case-v2.json'), 'utf8'));
  const common = {challengeId: protocol.challengeId, freezeCommitSha: 'a'.repeat(40), profileSha256: 'b'.repeat(64), mutationSpecSha256: 'c'.repeat(64),
    sourceCandidateHash: 'd'.repeat(64), runtimeCandidateHash: 'e'.repeat(64), generationEvidenceSha256: 'f'.repeat(64)};
  for (const lane of ['B0', 'B1', 'B2', 'B4']) assert.equal(validateSingleCaseBinding(lane, {lane, ...common}, common), true);
  assert.equal(protocol.historicalCandidate143ccbAllowed, false);
  assert.equal(protocol.survivorS1Allowed, false);
  assert.throws(() => validateSingleCaseBinding('B1', {lane: 'B1', ...common, candidateId: 'survivor-s1'}, common), /SINGLE_CASE_BINDING_INVALID/);
});

test('DP05 candidate is absent at generation authority and bound at artifact commit; P03 runner remains unchanged', () => {
  const candidatePath = path.join(root, 'benchmark/challenge/node-cache-ttl-zero-v2');
  assertControlledCandidateLifecycle(root);
  const resultFiles = execFileSync('git', ['-C', root, 'ls-files', 'benchmark/results'], {encoding: 'utf8'}).trim();
  assert.equal(existsSync(candidatePath), false);
  assert.equal(resultFiles, 'benchmark/results/.gitkeep');
  const authorityRunner = execFileSync('git', ['-C', root, 'show', `${GENERATION_AUTHORITY_COMMIT}:src/evaluation/p03-runner.ts`], {encoding: 'buffer'});
  const artifactRunner = execFileSync('git', ['-C', root, 'show', `${CANDIDATE_ARTIFACT_COMMIT}:src/evaluation/p03-runner.ts`], {encoding: 'buffer'});
  assert.equal(digest(artifactRunner), digest(authorityRunner));
  assert.equal(digest(readFileSync(path.join(root, 'src/evaluation/p03-runner.ts'))), digest(artifactRunner),
    'P03_WORKTREE_DIFFERS_FROM_ARTIFACT_COMMIT');
});
