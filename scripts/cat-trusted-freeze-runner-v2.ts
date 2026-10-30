import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateControlledCandidate, preflightControlledCandidate} from '../src/benchmark/controlled-candidate-generator.ts';
import {FREEZE_V2_PATHS} from '../src/benchmark/freeze-authority-v2.ts';

const VERSION = 'TrustedCommittedRunnerV1';
const ENTRYPOINT = FREEZE_V2_PATHS.trustedRunnerEntrypoint;
const args = process.argv.slice(2);
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function value(name: string) {
  const indexes = args.map((arg, index) => arg === name ? index : -1).filter((index) => index >= 0);
  if (indexes.length !== 1 || !args[indexes[0] + 1]) throw new Error('TRUSTED_RUNNER_ARGUMENT_INVALID');
  return args[indexes[0] + 1];
}
function git(root: string, ...gitArgs: string[]) {
  const executable = process.env.CAT_TRUSTED_GIT_PATH || 'git';
  return execFileSync(executable, ['-C', root, ...gitArgs], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}
function samePath(left: string, right: string) {
  const a = path.resolve(left), b = path.resolve(right);
  return process.platform === 'win32' ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US') : a === b;
}
function ensureTrustedRunner(freezeSha: string, targetRoot: string) {
  if (!/^[a-f0-9]{40}$/.test(freezeSha)) throw new Error('FREEZE_COMMIT_SHA_REQUIRED');
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH) throw new Error('TRUSTED_RUNNER_NODE_ENVIRONMENT_UNSAFE');
  if (!process.env.CAT_TRUSTED_GIT_PATH || !path.isAbsolute(process.env.CAT_TRUSTED_GIT_PATH) ||
      !process.env.CAT_TRUSTED_NODE_PATH || !path.isAbsolute(process.env.CAT_TRUSTED_NODE_PATH) ||
      !samePath(realpathSync(process.execPath), realpathSync(process.env.CAT_TRUSTED_NODE_PATH))) throw new Error('TRUSTED_RUNNER_EXECUTABLE_INVALID');
  const runnerRoot = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const actualRunnerRoot = realpathSync(git(runnerRoot, 'rev-parse', '--show-toplevel'));
  if (!samePath(runnerRoot, actualRunnerRoot)) throw new Error('TRUSTED_RUNNER_ROOT_MISMATCH');
  const actualHead = git(runnerRoot, 'rev-parse', 'HEAD');
  if (actualHead !== freezeSha) throw new Error('TRUSTED_RUNNER_HEAD_MISMATCH');
  try { git(runnerRoot, 'diff', '--quiet', 'HEAD', '--'); } catch { throw new Error('TRUSTED_RUNNER_DIRTY'); }
  try { git(runnerRoot, 'diff', '--cached', '--quiet', 'HEAD', '--'); } catch { throw new Error('TRUSTED_RUNNER_STAGED_DIRTY'); }
  if (git(runnerRoot, 'status', '--porcelain=v1', '--untracked-files=no')) throw new Error('TRUSTED_RUNNER_DIRTY');
  const detached = (() => { try { git(runnerRoot, 'symbolic-ref', '-q', 'HEAD'); return false; } catch { return true; } })();
  if (!detached) throw new Error('TRUSTED_RUNNER_NOT_DETACHED');
  const actualTargetRoot = realpathSync(git(targetRoot, 'rev-parse', '--show-toplevel'));
  if (!samePath(path.resolve(targetRoot), actualTargetRoot) || samePath(actualRunnerRoot, actualTargetRoot)) throw new Error('TRUSTED_TARGET_REPOSITORY_INVALID');
  const runnerCommon = realpathSync(path.resolve(runnerRoot, git(runnerRoot, 'rev-parse', '--git-common-dir')));
  const targetCommon = realpathSync(path.resolve(targetRoot, git(targetRoot, 'rev-parse', '--git-common-dir')));
  if (!samePath(runnerCommon, targetCommon)) throw new Error('TRUSTED_TARGET_REPOSITORY_MISMATCH');
  return {runnerRoot, actualHead};
}

async function main() {
  const mode = value('--mode'), targetArg = value('--target-repo-root'), freezeSha = value('--freeze-commit');
  if (!path.isAbsolute(targetArg) || !existsSync(targetArg) || !['preflight', 'generate'].includes(mode)) throw new Error('TRUSTED_RUNNER_ARGUMENT_INVALID');
  if (args.filter((arg) => arg === '--output-dir').length > 1) throw new Error('TRUSTED_RUNNER_ARGUMENT_INVALID');
  const hasOutput = args.includes('--output-dir');
  if ((mode === 'preflight' && hasOutput) || (mode === 'generate' && (!hasOutput || args.length !== 8)) || (mode === 'preflight' && args.length !== 6)) {
    throw new Error('TRUSTED_RUNNER_ARGUMENT_INVALID');
  }
  const targetRoot = realpathSync(targetArg);
  const {runnerRoot, actualHead} = ensureTrustedRunner(freezeSha, targetRoot);
  const outputDirectory = mode === 'generate' ? value('--output-dir') : undefined;
  const preflight = preflightControlledCandidate({repoRoot: targetRoot, freezeCommitSha: freezeSha, outputDirectory});
  const closure = JSON.parse(preflight.controls.bytes[FREEZE_V2_PATHS.executableClosure].toString('utf8'));
  const entry = closure.rows.find((row: any) => row.path === ENTRYPOINT);
  const executingBytes = readFileSync(path.join(runnerRoot, ...ENTRYPOINT.split('/')));
  if (!entry || sha256(executingBytes) !== entry.commitBlobSha256 || !preflight.controls.bytes[ENTRYPOINT]?.equals(executingBytes)) {
    throw new Error('TRUSTED_RUNNER_SOURCE_MISMATCH');
  }
  const receipt = {
    version: 'TrustedRunnerPreflightV1', mode: 'preflight', freezeCommitSha: freezeSha, runnerHeadSha: actualHead,
    runnerMaterialization: 'DETACHED_GIT_WORKTREE', targetRepositoryRootId: 'REPOSITORY_ROOT',
    preCandidateManifestSha256: sha256(preflight.controls.bytes[FREEZE_V2_PATHS.preCandidateFreeze]),
    executableClosureSha256: preflight.controls.manifest.executableClosureSha256,
    dependencyIdentitySha256: preflight.dependency.identitySha256,
    baseSourceTreeSha256: preflight.controls.profile.base.sourceTreeSha256, candidateBundleAbsent: true,
    authorityStatus: 'VALID', createdAt: new Date().toISOString(),
  };
  if (mode === 'preflight') {
    process.stdout.write(JSON.stringify(receipt) + '\n');
    return;
  }
  const generated = await generateControlledCandidate({repoRoot: targetRoot, freezeCommitSha: freezeSha, outputDirectory: outputDirectory!});
  process.stdout.write(JSON.stringify({preflight: receipt, generation: generated}) + '\n');
}

main().catch((error) => {
  process.stderr.write(`CAT_TRUSTED_RUNNER_ERROR=${error instanceof Error ? error.message : 'TRUSTED_RUNNER_FAILED'}\n`);
  process.exitCode = 1;
});
