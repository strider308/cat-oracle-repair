import {createHash, randomUUID} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {lstatSync, readFileSync, readdirSync, mkdirSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {RepairBackend} from './production-lifecycle.ts';

export const REPAIR_DOCKER_IMAGE = 'sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32';
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export function selectRepairExecutionBackend(input: {sandboxVerified: boolean; otherNebiusVerified: boolean; localDockerReady: boolean}): RepairBackend {
  if (input.sandboxVerified) return 'NEBIUS_SANDBOX';
  if (input.otherNebiusVerified) return 'NEBIUS_OTHER_VERIFIED_EXECUTION';
  if (input.localDockerReady) return 'LOCAL_DOCKER_FALLBACK';
  throw new Error('NO_VERIFIED_EXECUTION_BACKEND');
}

export function hashExecutionTree(root: string) {
  const rows: {path: string; sha256: string; bytes: number}[] = [];
  const visit = (dir: string) => {
    for (const item of readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, item.name);
      const info = lstatSync(file);
      if (item.isSymbolicLink() || info.isSymbolicLink()) throw new Error('EXECUTION_DEPENDENCY_LINK_REJECTED');
      if (item.isDirectory()) visit(file);
      else if (item.isFile()) { const bytes = readFileSync(file); rows.push({path: path.relative(root, file).split(path.sep).join('/'), sha256: hash(bytes), bytes: bytes.length}); }
      else throw new Error('EXECUTION_DEPENDENCY_FILE_TYPE_REJECTED');
    }
  };
  visit(root);
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {rows, sha256: hash(JSON.stringify(rows))};
}

function runManagedDocker(host: string, args: string[], input: string | Buffer = '') {
  const config = path.join(os.tmpdir(), 'cat-p05s-docker-' + randomUUID());
  mkdirSync(config, {mode: 0o700});
  try {
    const env = {PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? {SystemRoot: process.env.SystemRoot} : {}), TEMP: os.tmpdir(), TMP: os.tmpdir(), DOCKER_CONFIG: config, DOCKER_HOST: host};
    const evidence: {name: string; args: string[]; exitCode: number | null; outputSha256: string}[] = [];
    const call = (name: string, dockerArgs: string[], callInput: string | Buffer = '', timeout = 10000) => {
      const result = spawnSync('docker', dockerArgs, {cwd: process.cwd(), env, input: callInput, encoding: 'utf8', timeout, maxBuffer: 262144, windowsHide: true});
      evidence.push({name, args: ['docker', ...dockerArgs], exitCode: result.status, outputSha256: hash((result.stdout ?? '') + '\0' + (result.stderr ?? ''))});
      return result;
    };
    const created = call('create', args, '', 30000);
    const id = created.stdout?.trim();
    if (created.error || created.status !== 0 || !id || !/^[a-f0-9]{64}$/i.test(id)) throw new Error('DOCKER_CREATE_FAILED');
    const started = call('start', ['start', '-a', '-i', id], input, 90000);
    const inspected = call('inspect', ['inspect', '--format={{json .State}}', id]);
    if (inspected.error || inspected.status !== 0) {
      call('kill', ['kill', id]);
      const removed = call('remove', ['rm', '-f', id]);
      const remaining = call('verify-removed', ['container', 'ls', '-a', '--no-trunc', '--filter', 'id=' + id, '--format', '{{.ID}}']);
      if (removed.error || removed.status !== 0 || remaining.error || remaining.status !== 0 || remaining.stdout.trim()) throw new Error('CONTAINER_CLEANUP_UNVERIFIED');
      throw new Error('DOCKER_INSPECT_FAILED');
    }
    let state: any;
    try { state = JSON.parse(inspected.stdout.trim()); } catch { state = null; }
    const removed = call('remove', ['rm', '-f', id]);
    const remaining = call('verify-removed', ['container', 'ls', '-a', '--no-trunc', '--filter', 'id=' + id, '--format', '{{.ID}}']);
    if (removed.error || removed.status !== 0 || remaining.error || remaining.status !== 0 || remaining.stdout.trim()) throw new Error('CONTAINER_CLEANUP_UNVERIFIED');
    if (started.error || started.signal || !state || state.Status !== 'exited' || state.Running !== false || state.OOMKilled || state.Dead ||
        !Number.isSafeInteger(state.ExitCode) || started.status !== state.ExitCode) {
      throw new Error('DOCKER_OPERATION_UNAVAILABLE');
    }
    return {stdout: started.stdout, stderr: started.stderr, lifecycle: evidence, containerId: id,
      createExitCode: created.status, startExitCode: started.status, inspectExitCode: inspected.status,
      removeExitCode: removed.status, verifyRemovedExitCode: remaining.status, containerRemovalVerified: true,
      containerState: {status: state.Status, running: state.Running, oomKilled: state.OOMKilled, dead: state.Dead, exitCode: state.ExitCode}};
  } finally { rmSync(config, {recursive: true, force: true}); }
}

function dockerHost() {
  const name = execFileSync('docker', ['context', 'show'], {encoding: 'utf8', windowsHide: true, timeout: 10000}).trim();
  const host = execFileSync('docker', ['context', 'inspect', '--format={{.Endpoints.docker.Host}}', name], {encoding: 'utf8', windowsHide: true, timeout: 10000}).trim();
  const allowed = process.platform === 'win32' ? ['npipe:////./pipe/dockerDesktopLinuxEngine', 'npipe:////./pipe/docker_engine'].includes(host) : host.startsWith('unix:///');
  if (!allowed) throw new Error('LOCAL_DOCKER_ENDPOINT_REQUIRED');
  return host;
}

export function createLocalDockerBackend(input: {repositoryRoot: string; dependencyRoot: string; runnerPath: string}) {
  const host = dockerHost();
  const dockerVersion = execFileSync('docker', ['version', '--format={{.Client.Version}}/{{.Server.Version}}'], {encoding: 'utf8', windowsHide: true, timeout: 10000}).trim();
  const dependencyRoot = path.resolve(input.dependencyRoot);
  const dependencyManifest = hashExecutionTree(dependencyRoot);
  const runnerRealPath = path.resolve(input.runnerPath);
  const repo = path.resolve(input.repositoryRoot);
  if (!runnerRealPath.startsWith(repo + path.sep) || path.relative(repo, dependencyRoot).startsWith('..')) throw new Error('EXECUTION_INPUT_PATH_INVALID');
  execFileSync('docker', ['image', 'inspect', REPAIR_DOCKER_IMAGE], {encoding: 'utf8', windowsHide: true, timeout: 10000});
  const backend = selectRepairExecutionBackend({sandboxVerified: false, otherNebiusVerified: false, localDockerReady: true});
  const execute = (operation: 'build' | 'suite' | 'observe', candidateRoot: string, options: {readOnly: boolean; input?: Buffer | string}): {
    result: {operation: string; exitCode: number; operational: boolean; outputSha256: string; runtimeSha256: string; observation?: Record<string, unknown> | null;
      observationStartedAt?: number | null; observationFinishedAt?: number | null};
    startedAt: string; finishedAt: string; command: string[]; dockerCommands: unknown;
  } => {
    const container = 'cat-p05s-' + randomUUID();
    const createArgs = ['create', '--pull=never', '-i', '--name', container, '--network', 'none', '--read-only', '--pids-limit', '64', '--memory', '256m', '--cpus', '1',
      '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
      '--workdir', '/candidate', '--env', 'NODE_PATH=/deps/node_modules', '--mount', `type=bind,source=${candidateRoot},target=/candidate${options.readOnly ? ',readonly' : ''}`,
      '--mount', `type=bind,source=${dependencyRoot},target=/deps/node_modules,readonly`, '--mount', `type=bind,source=${runnerRealPath},target=/runner.cjs,readonly`,
      REPAIR_DOCKER_IMAGE, 'node', '/runner.cjs', operation];
    const startedAt = new Date().toISOString();
    const dockerRun = runManagedDocker(host, createArgs, options.input ?? '');
    const finishedAt = new Date().toISOString();
    let result: unknown;
    try { result = JSON.parse(dockerRun.stdout.trim()); } catch { throw new Error('DOCKER_RESULT_INVALID'); }
    if (!result || typeof result !== 'object' || (result as any).operation !== operation || !Number.isSafeInteger((result as any).exitCode) ||
        typeof (result as any).operational !== 'boolean' || !/^[a-f0-9]{64}$/.test((result as any).outputSha256) || !/^[a-f0-9]{64}$/.test((result as any).runtimeSha256)) throw new Error('DOCKER_RESULT_INVALID');
    const executionEvidenceId = randomUUID();
    return {result: result as ReturnType<typeof execute>['result'], startedAt, finishedAt, command: ['node /runner.cjs ' + operation], executionEvidenceId,
      dockerCommands: {version: 1, executionEvidenceId, backend: 'LOCAL_DOCKER_FALLBACK', operation, startedAt, finishedAt,
        containerId: dockerRun.containerId, createInvoked: true, createExitCode: dockerRun.createExitCode,
        startAttachInvoked: true, dockerClientExitCode: dockerRun.startExitCode, inspectPerformed: true, inspectExitCode: dockerRun.inspectExitCode,
        startStdout: dockerRun.stdout, startStderr: dockerRun.stderr,
        terminalState: dockerRun.containerState,
        policy: {network: 'none', readOnlyRoot: true, nonRoot: true, capDropAll: true, noNewPrivileges: true,
          pidsLimit: 64, memoryLimit: '256m', cpuLimit: 1},
        cleanup: {attempted: true, removeExitCode: dockerRun.removeExitCode, removedContainerId: dockerRun.containerId,
          containerRemovalVerified: dockerRun.containerRemovalVerified, verifyExitCode: dockerRun.verifyRemovedExitCode, cleanupResult: 'PASS'},
        command: ['node /runner.cjs ' + operation], commands: dockerRun.lifecycle, result: result as ReturnType<typeof execute>['result']}};
  };
  return {backend, host, dockerVersion, dependencyManifest, execute};
}

export function sandboxAvailability() {
  const candidatePaths = (process.env.PATH ?? '').split(path.delimiter);
  const executable = candidatePaths.map((dir) => path.join(dir, process.platform === 'win32' ? 'contree.exe' : 'contree')).find((file) => {
    try { return lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(); } catch { return false; }
  });
  if (!executable) return {status: 'SANDBOX_CLIENT_UNAVAILABLE', auth: 'UNKNOWN', project: 'UNKNOWN', operationId: null, safeOutputSha256: null, reason: 'OFFICIAL_CLIENT_NOT_FOUND'};
  const cwd = path.resolve(process.cwd());
  const resolved = path.resolve(executable);
  if (resolved.startsWith(cwd + path.sep)) return {status: 'SANDBOX_CLIENT_UNAVAILABLE', auth: 'UNKNOWN', project: 'UNKNOWN', operationId: null, safeOutputSha256: null, reason: 'WORKSPACE_CLIENT_REJECTED'};
  const auth = spawnSync(resolved, ['auth', 'ls', '--offline'], {encoding: 'utf8', timeout: 10000, maxBuffer: 32768, windowsHide: true, env: {PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? {SystemRoot: process.env.SystemRoot} : {})}});
  const authStatus = !auth.error && auth.status === 0 ? 'CONFIGURED' : 'MISSING';
  const projectStatus = Object.hasOwn(process.env, 'NEBIUS_PROJECT_ID') && !!process.env.NEBIUS_PROJECT_ID ? 'CONFIGURED' : 'MISSING';
  const outputHash = hash(Buffer.from((auth.stdout ?? '') + '\0' + (auth.stderr ?? '')));
  // The current official interface does not provide a verified no-egress policy for candidate execution.
  const status = authStatus !== 'CONFIGURED' ? 'SANDBOX_AUTH_MISSING' : projectStatus !== 'CONFIGURED' ? 'SANDBOX_PROJECT_MISSING' : 'SANDBOX_CAPABILITY_UNAVAILABLE';
  return {status, auth: authStatus, project: projectStatus, operationId: null, safeOutputSha256: outputHash,
    reason: status === 'SANDBOX_CAPABILITY_UNAVAILABLE' ? 'CANDIDATE_EGRESS_ISOLATION_UNATTESTED' : status};
}
