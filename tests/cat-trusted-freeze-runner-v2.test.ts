import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FREEZE_V2_ENTRYPOINTS, FREEZE_V2_PATHS, FREEZE_V2_PREPARATION_PATHS, FREEZE_V2_SUPPORT_PATHS,
  inventoryExecutableClosureAtCommit, prepareFreezeAuthorityV2} from '../src/benchmark/freeze-authority-v2.ts';
import {inventoryExecutableClosure} from '../src/benchmark/controlled-candidate-generator.ts';
import {canonical} from '../src/oracle/canonical.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gitPath = process.env.CAT_TRUSTED_GIT_PATH || process.env.PATH!.split(path.delimiter).map((part) => path.join(part, process.platform === 'win32' ? 'git.exe' : 'git')).find((file) => existsSync(file))!;
function cleanGitEnvironment(extra: NodeJS.ProcessEnv = {}) {
  const env = {...process.env, ...extra};
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_PAGER'].includes(key)) delete env[key];
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
}
const git = (repo: string, ...args: string[]) => execFileSync(gitPath, ['-C', repo, ...args], {encoding: 'utf8', env: cleanGitEnvironment(), stdio: ['ignore', 'pipe', 'pipe']}).trim();
const gitBytes = (repo: string, ...args: string[]) => execFileSync(gitPath, ['-C', repo, ...args], {env: cleanGitEnvironment(), stdio: ['ignore', 'pipe', 'pipe']});
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const copy = (from: string, to: string) => { mkdirSync(path.dirname(to), {recursive: true}); cpSync(from, to, {recursive: true}); };
function remove(target: string) {
  if (process.platform === 'win32') {
    const quoted = target.replaceAll("'", "''");
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `for ($i=0; $i -lt 40 -and (Test-Path -LiteralPath '${quoted}'); $i++) { try { Remove-Item -LiteralPath '${quoted}' -Recurse -Force -ErrorAction Stop } catch { Start-Sleep -Milliseconds 250 } }; if (Test-Path -LiteralPath '${quoted}') { exit 1 }`], {stdio: 'ignore'});
  } else rmSync(target, {recursive: true, force: true, maxRetries: 80, retryDelay: 250});
}

let sharedFixture: ReturnType<typeof createFixture> | undefined;
function fixture() { return sharedFixture ??= createFixture(); }
function createFixture() {
  const tempRoot = mkdtempSync(path.join(root, '.tmp-cat-trusted-runner-'));
  const repo = path.join(tempRoot, 'target');
  mkdirSync(repo);
  const profile = JSON.parse(readFileSync(path.join(root, 'benchmark/protocol/controlled-subject-profile-v1.json'), 'utf8'));
  const build = JSON.parse(readFileSync(path.join(root, 'benchmark/protocol/controlled-build-contract-v1.json'), 'utf8'));
  const trackedSources = inventoryExecutableClosure(root, FREEZE_V2_ENTRYPOINTS).map((row) => row.path);
  const prepSupport = FREEZE_V2_PREPARATION_PATHS.filter((file) => file !== FREEZE_V2_PATHS.preCandidateFreeze && file !== FREEZE_V2_PATHS.executableClosure);
  const support = FREEZE_V2_SUPPORT_PATHS.filter((file) => file !== FREEZE_V2_PATHS.preCandidateFreeze && file !== FREEZE_V2_PATHS.executableClosure);
  for (const file of new Set([...trackedSources, ...support, ...prepSupport])) copy(path.join(root, file), path.join(repo, file));
  copy(path.join(root, profile.base.sourceRoot), path.join(repo, profile.base.sourceRoot));
  git(repo, 'init', '--quiet');
  git(repo, 'config', 'user.name', 'CAT Synthetic Runner');
  git(repo, 'config', 'user.email', 'cat-runner@example.invalid');
  git(repo, 'config', 'core.autocrlf', 'true');
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'synthetic V2 base');
  const baseSha = git(repo, 'rev-parse', 'HEAD');
  const prepared = prepareFreezeAuthorityV2(repo, baseSha, FREEZE_V2_PREPARATION_PATHS);
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'synthetic trusted runner freeze');
  const freezeSha = git(repo, 'rev-parse', 'HEAD');
  const runner = path.join(tempRoot, 'runner');
  const hooks = path.join(tempRoot, 'hooks');
  mkdirSync(hooks);
  assert.equal(git(repo, 'rev-parse', '--is-inside-work-tree'), 'true');
  git(repo, '-c', `core.hooksPath=${hooks}`, 'worktree', 'add', '--quiet', '--detach', runner, freezeSha);
  copy(path.join(root, profile.dependencyIdentity.root), path.join(repo, profile.dependencyIdentity.root));
  copy(path.join(root, build.dependency.lockfilePath), path.join(repo, build.dependency.lockfilePath));
  const entrypoint = path.join(runner, ...FREEZE_V2_PATHS.trustedRunnerEntrypoint.split('/'));
  const run = (sha = freezeSha, target = repo, mode: 'preflight' | 'generate' = 'preflight') => {
    try {
      const args = ['--experimental-strip-types', entrypoint, '--mode', mode, '--target-repo-root', target, '--freeze-commit', sha];
      if (mode === 'generate') args.push('--output-dir', 'fixtures/hero/node-cache-ttl-zero-001/candidates/dp05b-controlled-v1');
      const output = execFileSync(process.execPath, args, {cwd: runner, encoding: 'utf8', env: cleanGitEnvironment({NODE_OPTIONS: '', NODE_PATH: '', CAT_TRUSTED_GIT_PATH: gitPath, CAT_TRUSTED_NODE_PATH: process.execPath}), stdio: ['ignore', 'pipe', 'pipe']});
      return {ok: true, output, error: ''};
    } catch (error: any) { return {ok: false, output: String(error.stdout ?? ''), error: String(error.stderr ?? '')}; }
  };
  const runBootstrap = () => {
    const launcher = path.join(runner, 'scripts/Invoke-CatTrustedFreezeRunnerV2.ps1');
    try {
      const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-TargetRepoRoot', repo, '-FreezeCommit', freezeSha], {
        cwd: root, encoding: 'utf8', env: cleanGitEnvironment({TEMP: tempRoot, TMP: tempRoot}), stdio: ['ignore', 'pipe', 'pipe']});
      return {ok: true, output, error: ''};
    } catch (error: any) { return {ok: false, output: String(error.stdout ?? ''), error: String(error.stderr ?? '')}; }
  };
  return {repo, runner, entrypoint, freezeSha, baseSha, prepared, run, runBootstrap, cleanup: () => {
    try {
      git(repo, 'worktree', 'remove', '--force', runner);
      git(repo, 'worktree', 'prune');
      return {directoryRemoved: !existsSync(runner), leakedRegistration: git(repo, 'worktree', 'list', '--porcelain').includes(runner)};
    } finally { remove(tempRoot); sharedFixture = undefined; }
  }};
}

test('V2 preparation binds the trusted runner and every artifact from its prepared tree', () => {
  assert.equal(FREEZE_V2_PREPARATION_PATHS.filter((file) => file === FREEZE_V2_PATHS.trustedRunnerEntrypoint).length, 1);
  const f = fixture();
  try {
    const rows = f.prepared.closure.rows;
    assert.equal(rows.filter((row) => row.path === FREEZE_V2_PATHS.trustedRunnerEntrypoint).length, 1);
    assert.equal(f.prepared.manifest.trustedRunnerVersion, 'TrustedCommittedRunnerV1');
    assert.equal(f.prepared.manifest.trustedRunnerEntrypointPath, FREEZE_V2_PATHS.trustedRunnerEntrypoint);
    assert.equal(f.prepared.manifest.trustedRunnerSourceIdentitySha256,
      sha256(canonical(rows.filter((row) => row.path === FREEZE_V2_PATHS.trustedRunnerEntrypoint))));
    for (const [file, expected] of Object.entries(f.prepared.manifest.artifacts)) {
      const oid = git(f.repo, 'rev-parse', `${f.prepared.futureTreeSha}:${file}`);
      assert.equal(sha256(gitBytes(f.repo, 'cat-file', 'blob', oid)), expected, file);
    }
    for (const file of [FREEZE_V2_PATHS.trustedRunnerBootstrap, FREEZE_V2_PATHS.trustedRunnerTests]) {
      assert.match(f.prepared.manifest.artifacts[file], /^[a-f0-9]{64}$/);
    }
  } finally {
    f.cleanup();
  }
});

test('detached runner preflight is freeze-bound, side-effect free, and leaves no worktree registration', () => {
  const f = fixture();
  const indexPath = path.resolve(f.repo, git(f.repo, 'rev-parse', '--git-path', 'index'));
  const indexBefore = readFileSync(indexPath);
  const loader = path.join(f.repo, 'src/benchmark/freeze-authority-v2.ts');
  const original = readFileSync(loader);
  try {
    const result = f.runBootstrap();
    assert.equal(result.ok, true, result.error);
    const receipt = JSON.parse(result.output.trim().split(/\r?\n/).at(-1)!);
    assert.equal(git(f.repo, 'worktree', 'list', '--porcelain').includes('cat-freeze-runner-'), false);
    assert.equal(receipt.version, 'TrustedRunnerPreflightV1');
    assert.equal(receipt.freezeCommitSha, f.freezeSha);
    assert.equal(receipt.runnerHeadSha, f.freezeSha);
    assert.equal(receipt.candidateBundleAbsent, true);
    assert.ok(f.prepared.closure.rows.some((row) => row.path === FREEZE_V2_PATHS.trustedRunnerEntrypoint));
    assert.equal(existsSync(path.join(f.repo, 'fixtures/hero/node-cache-ttl-zero-001/candidates/dp05b-controlled-v1')), false);
    assert.deepEqual(readFileSync(indexPath), indexBefore);

    writeFileSync(loader, Buffer.from(original.toString('utf8').replace('FREEZE_COMMIT_SHA_REQUIRED', 'MUTABLE_LOADER_BYPASS')));
    const substituted = f.run();
    assert.equal(substituted.ok, false);
    assert.match(substituted.error, /FREEZE_WORKTREE_(MUTATION|BLOB)_REJECTED|FREEZE_V2/);
    assert.match(f.run(f.freezeSha, f.repo, 'generate').error, /FREEZE_WORKTREE_(MUTATION|BLOB)_REJECTED|FREEZE_V2/);
    assert.equal(existsSync(path.join(f.repo, 'fixtures/hero/node-cache-ttl-zero-001/candidates/dp05b-controlled-v1')), false);
  } finally {
    writeFileSync(loader, original);
  }
});

test('generate mode rejects drift before creating candidate output', () => {
  const f = fixture();
  const output = path.join(f.repo, 'fixtures/hero/node-cache-ttl-zero-001/candidates/dp05b-controlled-v1');
  const targetClosureFile = path.join(f.repo, 'src/benchmark/controlled-candidate-generator.ts');
  const original = readFileSync(targetClosureFile);
  try {
    writeFileSync(targetClosureFile, Buffer.from(original.toString('utf8').replace('CONTROLLED_OUTPUT_PATH_REJECTED', 'MUTABLE_GENERATOR_BYPASS')));
    const result = f.run(f.freezeSha, f.repo, 'generate');
    assert.equal(result.ok, false);
    assert.match(result.error, /FREEZE_WORKTREE_(MUTATION|BLOB)_REJECTED|FREEZE_V2/);
    assert.equal(existsSync(output), false);
  } finally {
    writeFileSync(targetClosureFile, original);
  }
});

test('runner rejects invalid SHA, mismatched or dirty materialization, wrong target, and existing output', () => {
  const f = fixture();
  try {
    assert.equal(f.run('HEAD').ok, false);
    assert.equal(f.run('f'.repeat(40)).ok, false);
    assert.equal(f.run(f.freezeSha, path.join(root, '.tmp-cat-trusted-runner-missing')).ok, false);
    const wrongRepo = mkdtempSync(path.join(root, '.tmp-cat-trusted-runner-wrong-'));
    try { git(wrongRepo, 'init', '--quiet'); assert.equal(f.run(f.freezeSha, wrongRepo).ok, false); } finally { remove(wrongRepo); }

    const file = path.join(f.runner, 'scripts/cat-trusted-freeze-runner-v2.ts');
    const original = readFileSync(file);
    writeFileSync(file, Buffer.concat([original, Buffer.from('\n// dirty\n')]));
    assert.match(f.run().error, /TRUSTED_RUNNER_(DIRTY|STAGED_DIRTY)/);
    writeFileSync(file, original);

    const output = path.join(f.repo, 'fixtures/hero/node-cache-ttl-zero-001/candidates/dp05b-controlled-v1');
    mkdirSync(output, {recursive: true});
    assert.match(f.run().error, /CONTROLLED_OUTPUT_PATH_REJECTED/);
    assert.equal(existsSync(path.join(output, 'manifest.json')), false);
  } finally {
    const cleanup = f.cleanup();
    assert.deepEqual(cleanup, {directoryRemoved: true, leakedRegistration: false});
  }
});
