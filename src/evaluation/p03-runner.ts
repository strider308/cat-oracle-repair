import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {finalizeReceipt, verifyReceipt} from '../core/receipt.ts';

export type OracleStatus = 'UNCALIBRATED' | 'WEAK' | 'CALIBRATED';
export const OracleStatus = Object.freeze({UNCALIBRATED: 'UNCALIBRATED', WEAK: 'WEAK', CALIBRATED: 'CALIBRATED'});
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const buildEvidenceTools = require('./p03-build-evidence.cjs');
const HISTORICAL_P03_RECEIPT_HASH = '1271e7ed0552bc752c714e27ce61b65e79ebbc3446879e05ff158126c54f735b';
const HISTORICAL_P03_CONTROLLER_HASH = 'f29e04e2c5ab8daee8b487adaa2868f319d9a6ffc9c70d7484cce1aca6041e36';
const HISTORICAL_P03_ARCHIVE = {
  'suite-evidence': 'evidence/historical/p03-v2/suite-evidence.18055ed675c50f2e4e2ae58ff345498dd10656010e485559152fb99e5949f199.json',
  'candidate-executions': 'evidence/historical/p03-v2/candidate-executions.a68061ecb461ad30f44582372adb23df8f272df205b799bad0996938f0fff1a7.json',
  'oracle-attack': 'evidence/historical/p03-v2/oracle-attack.aca2f79c77c65d716c2d36f6ae8feaa41d281a6685285d8c7ed3237fafdf6df4.json',
  'target-adapter': 'evidence/historical/p03-v2/target-adapter.ac7f561c301b3920c3c9345519fb2bdf43b8297eb931b5c7fe3a9c02737686be.cjs',
  'suite-runner': 'evidence/historical/p03-v2/suite-runner.244c62e6846389596b8f708835ed2a225502f0f60f6598613abca51bb10b05aa.cjs',
};
const HISTORICAL_P03_RECEIPT_FILE = 'evidence/historical/p03-v2/receipt-v2.1271e7ed0552bc752c714e27ce61b65e79ebbc3446879e05ff158126c54f735b.json';
const DURABLE_P03_ARTIFACT_IDS = new Set(['suite-evidence', 'build-evidence-v2', 'candidate-executions', 'oracle-attack']);
const P03_DURABLE_STORE_RELATIVE_ROOT = 'cat-p04-recovery/p03-durable-evidence/sha256';
const CASE = path.join(ROOT, 'fixtures/hero/node-cache-ttl-zero-001');
const IMAGE = 'sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32';
const BRANCH = 'hackathon/nebius-nvidia-cat-r5-20261006';
const MAX_OUT = 4096;
const MAX_ERR = 4096;
const TIMEOUT_MS = 180000;
let activeDockerHost: string | undefined;

function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }
function inventorySourceTree(dir) {
  const rows = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, {withFileTypes: true})) {
      const file = path.join(current, entry.name);
      const relative = path.relative(dir, file).split(path.sep).join('/');
      if (entry.isSymbolicLink()) throw new Error('SOURCE_SYMLINK_REJECTED:' + relative);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) rows.push({path: relative, sha256: sha256(readFileSync(file))});
      else throw new Error('SOURCE_FILE_TYPE_REJECTED:' + relative);
    }
  };
  visit(dir);
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return rows;
}
function safeWrite(file, text) {
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, text, {flag: 'wx'});
}
function inventoryRuntime(dir) {
  const rows = [];
  for (const name of ['index.js', 'lib/node_cache.js']) {
    const file = path.join(dir, name);
    if (!existsSync(file) || lstatSync(file).isSymbolicLink()) throw new Error('CANDIDATE_ARTIFACT_MISSING:' + name);
    rows.push({path: name, sha256: sha256(readFileSync(file))});
  }
  return rows;
}
function artifactHash(rows) { return sha256(canonical(rows)); }
function p03DurableStoreRoot(root) { return path.resolve(path.dirname(root), P03_DURABLE_STORE_RELATIVE_ROOT); }
function persistP03DurableBytes(bytes, root) {
  const hash = sha256(bytes);
  const store = p03DurableStoreRoot(root);
  mkdirSync(store, {recursive: true});
  const destination = path.join(store, hash);
  if (existsSync(destination)) {
    if (lstatSync(destination).isSymbolicLink() || sha256(readFileSync(destination)) !== hash) throw new Error('DURABLE_P03_STORE_COLLISION');
  } else writeFileSync(destination, bytes, {flag: 'wx'});
  return 'durable://p03/sha256/' + hash;
}
function persistP03DurableArtifact(file, root) { return persistP03DurableBytes(readFileSync(file), root); }
function expectedP03WorkspaceLocators(root) {
  const caseRoot = path.join(root, 'fixtures/hero/node-cache-ttl-zero-001');
  const manifest = readJson(path.join(caseRoot, 'manifest.json'));
  const sourceRows = readJson(path.join(caseRoot, 'sources.json'));
  const resolve = (file) => path.relative(root, file);
  const paths = {
    'suite-evidence': null, 'build-evidence-v2': null, 'candidate-executions': null, 'oracle-attack': null,
    contract: resolve(path.join(caseRoot, 'contract.json')), sources: resolve(path.join(caseRoot, 'sources.json')),
    'oracle-v1': resolve(path.join(caseRoot, 'oracle-v1.json')), 'oracle-v2': resolve(path.join(caseRoot, 'oracle-v2.json')),
    'suite-lockfile': resolve(path.join(caseRoot, 'suite/package-lock.json')), 'fixture-manifest': resolve(path.join(caseRoot, 'manifest.json')),
    witness: resolve(path.join(caseRoot, 'witness.json')), 'target-adapter': resolve(path.join(caseRoot, 'adapter.cjs')),
    'suite-runner': resolve(path.join(caseRoot, 'suite-runner.cjs')), 'controller-runner': path.join('src', 'evaluation', 'p03-runner.ts'),
    'build-evidence-normalizer': 'src/evaluation/p03-build-evidence.cjs',
  };
  for (const row of sourceRows) paths['source-' + row.id] = resolve(path.resolve(caseRoot, row.artifactPath));
  for (const [version, relative] of Object.entries({v3: 'suite/source', v4: 'upstream/4.0.0'})) {
    for (const row of inventorySourceTree(path.join(caseRoot, relative))) {
      paths['source-tree-' + version + '-' + row.path.replaceAll('/', '-')] = resolve(path.join(caseRoot, relative, ...row.path.split('/')));
    }
  }
  for (const spec of manifest.candidates.filter((item) => !item.upstreamCommit)) {
    paths['candidate-' + spec.name + '-index.js'] = resolve(path.join(caseRoot, spec.path, 'index.js'));
  }
  return paths;
}
function dockerHost() {
  if (activeDockerHost) return activeDockerHost;
  const context = spawnSync('docker', ['context', 'show'], {cwd: ROOT, encoding: 'utf8', windowsHide: true});
  if (context.error || context.status !== 0) throw new Error('LOCAL_DOCKER_CONTEXT_UNAVAILABLE');
  const name = context.stdout.trim();
  const endpoint = spawnSync('docker', ['context', 'inspect', '--format={{.Endpoints.docker.Host}}', name], {cwd: ROOT, encoding: 'utf8', windowsHide: true});
  if (endpoint.error || endpoint.status !== 0) throw new Error('LOCAL_DOCKER_ENDPOINT_UNAVAILABLE');
  const host = endpoint.stdout.trim();
  const allowed = process.platform === 'win32'
    ? ['npipe:////./pipe/dockerDesktopLinuxEngine', 'npipe:////./pipe/docker_engine'].includes(host)
    : host.startsWith('unix:///');
  if (!allowed) throw new Error('LOCAL_DOCKER_ENDPOINT_REQUIRED');
  activeDockerHost = host;
  return host;
}
function diagnosticTail(previous, chunk, limit) {
  const combined = Buffer.concat([previous, chunk]);
  return combined.length > limit ? combined.subarray(combined.length - limit) : combined;
}
function safeTail(buffer, limit = MAX_OUT, extraRedactions = []) {
  let text = buffer.toString('utf8').replaceAll(ROOT, '<REPOSITORY_ROOT>').replaceAll(CASE, '<CASE_ROOT>');
  for (const value of extraRedactions.filter(Boolean)) text = text.replaceAll(value, '<LOCAL_PATH>');
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '�');
  const bytes = Buffer.from(text);
  let tail = (bytes.length > limit ? bytes.subarray(bytes.length - limit) : bytes).toString('utf8');
  while (Buffer.byteLength(tail) > limit) tail = tail.slice(1);
  return tail;
}
function diagnosticArgs(args) {
  const result = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cidfile') { result.push('--cidfile', '<CID_FILE>'); i++; }
    else if (args[i] === '--mount') {
      const mount = args[++i] || '';
      const target = mount.match(/(?:^|,)target=([^,]+)/)?.[1] || '<UNKNOWN_TARGET>';
      result.push('--mount', 'type=bind,source=<MOUNT_SOURCE>,target=' + target + (mount.endsWith(',readonly') ? ',readonly' : ''));
    } else result.push(args[i]);
  }
  return result;
}
function mountIdentifiers(args) {
  const mounts = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--mount') continue;
    const target = (args[++i] || '').match(/(?:^|,)target=([^,]+)/)?.[1];
    if (target) mounts.push(target);
  }
  return mounts;
}
export function captureTargetChild(child, context, options = {}) {
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  let outputLimited = false;
  let spawnErrorCode = null;
  let terminationPromise = null;
  const terminate = () => {
    if (!terminationPromise) {
      terminationPromise = Promise.resolve().then(() => options.terminate?.())
        .catch((error) => ({errorCode: error?.code || error?.name || 'TERMINATION_ERROR'}));
    }
    return terminationPromise;
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => { timedOut = true; void terminate(); }, options.timeoutMs ?? TIMEOUT_MS);
    child.stdout?.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      stdout = diagnosticTail(stdout, chunk, MAX_OUT);
      if (stdoutBytes > MAX_OUT || stdoutBytes + stderrBytes > MAX_OUT + MAX_ERR) { outputLimited = true; void terminate(); }
    });
    child.stderr?.on('data', (chunk) => {
      stderrBytes += chunk.length;
      stderr = diagnosticTail(stderr, chunk, MAX_ERR);
      if (stderrBytes > MAX_ERR || stdoutBytes + stderrBytes > MAX_OUT + MAX_ERR) { outputLimited = true; void terminate(); }
    });
    child.once('error', (error) => { spawnErrorCode = error?.code || error?.name || 'SPAWN_ERROR'; });
    child.once('close', async (code, signal) => {
      clearTimeout(timer);
      const terminationResult = terminationPromise ? await terminationPromise : null;
      let finalized = {};
      try { finalized = await options.finalize?.({timedOut, outputLimited, exitCode: code, signal, terminationResult}) || {}; }
      catch (error) { finalized = {cleanupResult: 'FAIL', cleanupErrorCode: error?.code || error?.name || 'CLEANUP_ERROR'}; }
      const reason = spawnErrorCode ? 'SPAWN_ERROR' : timedOut ? 'TIMEOUT' : outputLimited ? 'OUTPUT_LIMIT'
        : signal ? 'SIGNAL' : code !== 0 ? 'NONZERO_EXIT' : finalized.cleanupResult !== 'PASS' ? 'CLEANUP_FAILURE' : null;
      const diagnostic = {
        version: 1, status: reason === 'TIMEOUT' ? 'TIMEOUT' : reason ? 'PROCESS_ERROR' : 'COMPLETED', reason,
        logicalOperationId: context.logicalOperationId, operationId: context.operationId, attemptId: context.attemptId,
        candidateId: context.candidateId, candidateKind: context.candidateKind, oracleVersion: context.oracleVersion,
        challengeId: context.challengeId, candidateArtifactSha256: context.candidateArtifactSha256,
        dockerExecutable: context.dockerExecutable || 'docker', dockerArgs: context.dockerArgs, dockerArgsSha256: context.dockerArgsSha256,
        workingDirectoryId: 'REPOSITORY_ROOT', mountIdentifiers: context.mountIdentifiers,
        containerName: context.containerName, containerId: finalized.containerId || null,
        containerIdSha256: finalized.containerIdSha256 || null,
        startedAt: context.startedAt, endedAt: new Date().toISOString(), exitCode: Number.isInteger(code) ? code : null,
        signal: signal || null, timedOut, stdoutBytes, stderrBytes,
        stdoutTailSha256: sha256(stdout), stderrTailSha256: sha256(stderr),
        stdoutTail: reason ? safeTail(stdout) : '', stderrTail: reason ? safeTail(stderr) : '',
        dockerState: finalized.dockerState || {status: 'UNAVAILABLE_AFTER_AUTO_REMOVE'}, cleanupAttempted: true,
        cleanupResult: finalized.cleanupResult || 'FAIL', cleanupDetails: finalized.cleanupDetails || {},
        spawnErrorCode,
      };
      resolve({stdout, stderr, diagnostic});
    });
    child.stdin?.on('error', () => {});
    if (child.stdin) child.stdin.end(options.input || '');
  });
}
function baseDockerArgs(name, operationId) {
  return ['create', '--pull=never', '-i', '--label', 'com.cat.p03.operation=' + operationId, '--name', name,
    '--network', 'none', '--read-only', '--pids-limit', '64', '--memory', '256m', '--cpus', '1',
    '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m'];
}
function targetContainerName(context) {
  const part = (value, max) => String(value || 'na').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, max) || 'na';
  const pieces = [
    'cat-p03', part(String(context.logicalOperationId).split(':')[0], 8), part(context.candidateId, 8),
    part(context.oracleVersion, 8), sha256(String(context.challengeId || '')).slice(0, 6),
    part(context.attemptId, 8), randomUUID().slice(0, 8),
  ];
  return pieces.join('-').slice(0, 63);
}
const DOCKER_COMMAND_TIMEOUT_MS = 10000;
const DOCKER_ID = /^[a-f0-9]{64}$/i;

function runDockerSync(args, env, timeoutMs = DOCKER_COMMAND_TIMEOUT_MS) {
  let result;
  try {
    result = spawnSync('docker', args, {
      cwd: ROOT, env, shell: false, windowsHide: true, encoding: 'buffer',
      timeout: timeoutMs, maxBuffer: MAX_OUT + MAX_ERR,
    });
  } catch (error) {
    return {exitCode: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0),
      stdoutBytes: 0, stderrBytes: 0, timedOut: false, outputLimited: false,
      spawnErrorCode: error?.code || error?.name || 'SPAWN_ERROR'};
  }
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '');
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || '');
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const outputLimited = result.error?.code === 'ENOBUFS' || stdout.length > MAX_OUT || stderr.length > MAX_ERR;
  return {
    exitCode: Number.isInteger(result.status) ? result.status : null, signal: result.signal || null,
    stdout, stderr, stdoutBytes: stdout.length, stderrBytes: stderr.length, timedOut, outputLimited,
    spawnErrorCode: timedOut || outputLimited ? null : result.error?.code || result.error?.name || null,
  };
}

function runDockerAttach(args, input, env, timeoutMs, terminate) {
  const child = spawn('docker', args, {cwd: ROOT, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  return captureTargetChild(child, {
    logicalOperationId: 'docker-attach', operationId: 'docker-attach', attemptId: 'docker-attach',
    candidateId: 'docker-target', candidateKind: 'docker-target', oracleVersion: 'N/A', challengeId: 'N/A',
    candidateArtifactSha256: null, dockerArgs: diagnosticArgs(args), dockerArgsSha256: sha256(canonical(args)),
    mountIdentifiers: [], containerName: null, startedAt: new Date().toISOString(),
  }, {
    input, timeoutMs, terminate: async () => {
      try { await terminate?.(); } finally { child.kill(); }
    }, finalize: () => ({cleanupResult: 'PASS'}),
  }).then((result) => ({
    exitCode: result.diagnostic.exitCode, signal: result.diagnostic.signal,
    stdout: result.stdout, stderr: result.stderr,
    stdoutBytes: result.diagnostic.stdoutBytes, stderrBytes: result.diagnostic.stderrBytes,
    timedOut: result.diagnostic.timedOut, outputLimited: result.diagnostic.reason === 'OUTPUT_LIMIT',
    spawnErrorCode: result.diagnostic.spawnErrorCode,
  }));
}

function parsedDockerState(result, redactions = []) {
  if (result.exitCode !== 0 || result.signal || result.timedOut || result.outputLimited || result.spawnErrorCode) return null;
  try {
    const state = JSON.parse(result.stdout.toString('utf8'));
    if (typeof state.Status !== 'string' || typeof state.Running !== 'boolean' || typeof state.Paused !== 'boolean' ||
        typeof state.Restarting !== 'boolean' || typeof state.OOMKilled !== 'boolean' || typeof state.Dead !== 'boolean' ||
        !Number.isInteger(state.Pid) || !Number.isInteger(state.ExitCode) || typeof state.Error !== 'string' ||
        typeof state.StartedAt !== 'string' || typeof state.FinishedAt !== 'string') return null;
    return {
      status: state.Status, running: state.Running, paused: state.Paused, restarting: state.Restarting,
      oomKilled: state.OOMKilled, dead: state.Dead, pid: state.Pid, exitCode: state.ExitCode,
      error: safeTail(Buffer.from(state.Error), MAX_ERR, redactions), startedAt: state.StartedAt, finishedAt: state.FinishedAt,
    };
  } catch { return null; }
}

function fullContainerId(output) {
  const id = output.toString('utf8').trim();
  return DOCKER_ID.test(id) ? id.toLowerCase() : null;
}

export async function runP03TargetLifecycle(args, input, context, options = {}) {
  const host = options.runCommand ? 'test' : dockerHost();
  const config = options.runCommand ? null : path.join(os.tmpdir(), 'cat-p03-docker-' + randomUUID());
  if (config) mkdirSync(config);
  const env = options.env || {PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir(),
    ...(config ? {DOCKER_CONFIG: config} : {}), ...(host !== 'test' ? {DOCKER_HOST: host} : {})};
  const command = options.runCommand || ((commandArgs, commandOptions = {}) => {
    if (commandArgs[0] === 'start') {
      return runDockerAttach(commandArgs, commandOptions.input || '', env, commandOptions.timeoutMs, commandOptions.terminate);
    }
    return Promise.resolve(runDockerSync(commandArgs, env, commandOptions.timeoutMs));
  });
  const operationId = context.operationId;
  const label = 'com.cat.p03.operation=' + operationId;
  const commands = [];
  const record = (name, commandArgs) => commands.push({name, args: diagnosticArgs(commandArgs), sha256: sha256(canonical(commandArgs))});
  const invoke = async (name, commandArgs, commandOptions = {}) => {
    record(name, commandArgs);
    return command(commandArgs, commandOptions);
  };
  const diagnostic = {
    version: 2, status: 'PROCESS_ERROR', reason: null,
    logicalOperationId: context.logicalOperationId, operationId, attemptId: context.attemptId,
    candidateId: context.candidateId, candidateKind: context.candidateKind, oracleVersion: context.oracleVersion,
    challengeId: context.challengeId, candidateArtifactSha256: context.candidateArtifactSha256,
    dockerExecutable: 'docker', dockerArgs: diagnosticArgs(args), dockerArgsSha256: sha256(canonical(args)),
    dockerCommands: commands, workingDirectoryId: 'REPOSITORY_ROOT', mountIdentifiers: mountIdentifiers(args),
    containerName: context.containerName, containerId: null, createExitCode: null, dockerClientExitCode: null,
    containerExitCode: null, signal: null, timedOut: false, stdoutBytes: 0, stderrBytes: 0,
    stdoutTailSha256: sha256(Buffer.alloc(0)), stderrTailSha256: sha256(Buffer.alloc(0)),
    stdoutTail: '', stderrTail: '', dockerState: null, cleanupAttempted: false, cleanupExitCode: null,
    containerRemovalVerified: false, cleanupResult: 'UNVERIFIED', spawnErrorCode: null,
    startedAt: new Date().toISOString(),
  };
  let id = null;
  let createResult = null;
  let startResult = null;
  let state = null;
  let stateCommandResult = null;
  let killResult = null;
  let reason = null;
  try {
    createResult = await invoke('create', args, {timeoutMs: options.createTimeoutMs || 30000});
    diagnostic.createExitCode = createResult.exitCode;
    diagnostic.createStdoutBytes = createResult.stdoutBytes || 0;
    diagnostic.createStderrBytes = createResult.stderrBytes || 0;
    diagnostic.createStdoutTail = safeTail(createResult.stdout || Buffer.alloc(0), MAX_OUT, [config]);
    diagnostic.createStderrTail = safeTail(createResult.stderr || Buffer.alloc(0), MAX_ERR, [config]);
    diagnostic.spawnErrorCode = createResult.spawnErrorCode || null;
    id = createResult.exitCode === 0 ? fullContainerId(createResult.stdout) : null;
    if (!id) {
      const owned = await invoke('recover-by-operation-label',
        ['container', 'ls', '-a', '--no-trunc', '--filter', 'label=' + label, '--format', '{{.ID}}'],
        {timeoutMs: DOCKER_COMMAND_TIMEOUT_MS});
      const ids = owned.exitCode === 0 ? owned.stdout.toString('utf8').trim().split(/\r?\n/).filter(Boolean).map(fullContainerId) : [];
      if (ids.length === 1 && ids[0]) id = ids[0];
      reason = createResult.timedOut ? 'CREATE_TIMEOUT' : createResult.outputLimited ? 'CREATE_OUTPUT_LIMIT'
        : createResult.spawnErrorCode ? 'CREATE_SPAWN_ERROR' : createResult.exitCode !== 0 ? 'CREATE_FAILURE' : 'CREATE_ID_INVALID';
    }
    diagnostic.containerId = id;
    if (id && createResult.exitCode === 0 && fullContainerId(createResult.stdout)) {
      const startArgs = ['start', '-a', '-i', id];
      startResult = await invoke('start', startArgs, {
        input, timeoutMs: options.timeoutMs || TIMEOUT_MS,
        terminate: async () => { killResult = await invoke('kill', ['kill', id], {timeoutMs: DOCKER_COMMAND_TIMEOUT_MS}); },
      });
      diagnostic.dockerClientExitCode = startResult.exitCode;
      diagnostic.signal = startResult.signal || null;
      diagnostic.timedOut = Boolean(startResult.timedOut);
      diagnostic.stdoutBytes = startResult.stdoutBytes || 0;
      diagnostic.stderrBytes = startResult.stderrBytes || 0;
      diagnostic.stdoutTail = safeTail(startResult.stdout || Buffer.alloc(0), MAX_OUT, [config]);
      diagnostic.stderrTail = safeTail(startResult.stderr || Buffer.alloc(0), MAX_ERR, [config]);
      diagnostic.stdoutTailSha256 = sha256(Buffer.from(diagnostic.stdoutTail));
      diagnostic.stderrTailSha256 = sha256(Buffer.from(diagnostic.stderrTail));
      diagnostic.spawnErrorCode = startResult.spawnErrorCode || diagnostic.spawnErrorCode;
    }
    if (id) {
      stateCommandResult = await invoke('inspect', ['inspect', '--format={{json .State}}', id], {timeoutMs: DOCKER_COMMAND_TIMEOUT_MS});
      state = parsedDockerState(stateCommandResult, [config]);
      if (state && (state.running || state.paused || state.restarting)) {
        reason ||= 'CONTAINER_NOT_TERMINATED';
        killResult = await invoke('kill', ['kill', id], {timeoutMs: DOCKER_COMMAND_TIMEOUT_MS});
        stateCommandResult = await invoke('inspect-after-kill', ['inspect', '--format={{json .State}}', id], {timeoutMs: DOCKER_COMMAND_TIMEOUT_MS});
        state = parsedDockerState(stateCommandResult, [config]);
      }
    }
  } catch (error) {
    diagnostic.controllerErrorCode = error?.code || error?.name || 'DOCKER_LIFECYCLE_ERROR';
    reason ||= 'DOCKER_LIFECYCLE_ERROR';
  }

  if (!reason) {
    if (!id) reason = 'CONTAINER_ID_UNAVAILABLE';
    else if (!state) reason = 'INSPECT_FAILURE';
    else if (diagnostic.timedOut) reason = 'TIMEOUT';
    else if (startResult?.outputLimited) reason = 'OUTPUT_LIMIT';
    else if (startResult?.spawnErrorCode || startResult?.signal || !Number.isInteger(startResult?.exitCode)) reason = 'DOCKER_CLIENT_ERROR';
    else if (state.running || state.paused || state.restarting) reason = 'CONTAINER_NOT_TERMINATED';
    else if (state.oomKilled) reason = 'OOM_KILLED';
    else if (state.dead || state.error) reason = 'CONTAINER_STATE_ERROR';
    else if (state.status !== 'exited') reason = 'CONTAINER_STATE_NOT_EXITED';
    else if (state.exitCode !== startResult.exitCode) reason = 'DOCKER_EXIT_MISMATCH';
    else if (state.exitCode !== 0) reason = 'NONZERO_EXIT';
  }
  diagnostic.dockerState = state;
  diagnostic.containerExitCode = state?.exitCode ?? null;
  diagnostic.exitCode = state?.exitCode ?? null;
  diagnostic.inspectExitCode = stateCommandResult?.exitCode ?? null;
  diagnostic.inspectStderrTail = safeTail(stateCommandResult?.stderr || Buffer.alloc(0), MAX_ERR, [config]);
  diagnostic.killExitCode = killResult?.exitCode ?? null;
  diagnostic.preCleanupEvidenceAssembledAt = new Date().toISOString();

  let removeResult = null;
  let verifyResult = null;
  if (id) {
    diagnostic.cleanupAttempted = true;
    diagnostic.cleanupStartedAt = new Date().toISOString();
    try {
      removeResult = await invoke('remove', ['rm', '-f', id], {timeoutMs: DOCKER_COMMAND_TIMEOUT_MS});
      diagnostic.cleanupExitCode = removeResult.exitCode;
      verifyResult = await invoke('verify-removed',
        ['container', 'ls', '-a', '--no-trunc', '--filter', 'id=' + id, '--format', '{{.ID}}'],
        {timeoutMs: DOCKER_COMMAND_TIMEOUT_MS});
      const remaining = verifyResult.exitCode === 0
        ? verifyResult.stdout.toString('utf8').trim().split(/\r?\n/).filter(Boolean) : [id];
      diagnostic.containerRemovalVerified = verifyResult.exitCode === 0 && !remaining.includes(id);
      diagnostic.cleanupResult = removeResult.exitCode === 0 && !removeResult.signal && !removeResult.timedOut &&
        !removeResult.outputLimited && !removeResult.spawnErrorCode && diagnostic.containerRemovalVerified ? 'PASS' : 'FAIL';
      diagnostic.cleanupDetails = {
        method: 'docker rm -f + exact-id listing', verifyExitCode: verifyResult.exitCode,
        verifyErrorCode: verifyResult.spawnErrorCode || null,
      };
    } catch (error) {
      diagnostic.cleanupResult = 'FAIL';
      diagnostic.cleanupErrorCode = error?.code || error?.name || 'CLEANUP_ERROR';
    }
  } else diagnostic.cleanupDetails = {method: 'no positively identified container'};
  if (diagnostic.cleanupResult !== 'PASS') reason ||= 'CLEANUP_FAILURE';
  if (config) {
    try { rmSync(config, {recursive: true, force: true}); diagnostic.dockerConfigRemoved = !existsSync(config); }
    catch { diagnostic.dockerConfigRemoved = false; }
  } else diagnostic.dockerConfigRemoved = true;
  if (!diagnostic.dockerConfigRemoved) reason ||= 'DOCKER_CONFIG_CLEANUP_FAILURE';
  diagnostic.reason = reason;
  diagnostic.status = reason === 'TIMEOUT' ? 'TIMEOUT' : reason ? 'PROCESS_ERROR' : 'COMPLETED';
  diagnostic.endedAt = new Date().toISOString();
  return {stdout: startResult?.stdout || Buffer.alloc(0), diagnostic};
}

async function spawnDocker(args, input = '', context = {}, diagnostics = []) {
  const capture = await runP03TargetLifecycle(args, input, context);
  diagnostics.push(capture.diagnostic);
  process.stderr.write('CAT_P03_TARGET_DIAGNOSTIC=' + JSON.stringify(capture.diagnostic) + '\n');
  if (capture.diagnostic.reason) {
    const error = new Error('TARGET_PROCESS_ERROR:candidate=' + capture.diagnostic.candidateId +
      ';oracle=' + capture.diagnostic.oracleVersion + ';challenge=' + capture.diagnostic.challengeId +
      ';create=' + capture.diagnostic.createExitCode + ';dockerClient=' + capture.diagnostic.dockerClientExitCode +
      ';container=' + capture.diagnostic.containerExitCode + ';signal=' + (capture.diagnostic.signal || '') +
      ';reason=' + capture.diagnostic.reason);
    Object.assign(error, {
      code: 'TARGET_PROCESS_ERROR', diagnostics: capture.diagnostic,
      precedingDiagnostics: diagnostics.slice(0, -1).map(({stdoutTail, stderrTail, ...row}) => row),
    });
    throw error;
  }
  return capture.stdout.toString('utf8');
}
async function runSuite(manifest, lockHash, runId, diagnostics) {
  const sourceTrees = {
    v3: inventorySourceTree(path.join(CASE, 'suite/source')),
    v4: inventorySourceTree(path.join(CASE, 'upstream/4.0.0')),
  };
  const sourceTreeHashes = {v3: artifactHash(sourceTrees.v3), v4: artifactHash(sourceTrees.v4)};
  const frozen = {
    v3: buildEvidenceTools.frozenRuntime(path.join(CASE, 'suite/source'), '3.2.1'),
    v4: buildEvidenceTools.frozenRuntime(path.join(CASE, 'upstream/4.0.0'), '4.0.0'),
  };
  for (const version of ['v3', 'v4']) {
    const spec = manifest.candidates.find((candidate) => candidate.name === (version === 'v3' ? 'wrong' : 'good'));
    if (sourceTreeHashes[version] !== spec.sourceTreeSha256) throw new Error('STALE_UPSTREAM_SOURCE_TREE:' + version);
  }
  const context = {
    logicalOperationId: runId + ':existing-suite:precheck', operationId: randomUUID(), attemptId: 'precheck-1',
    candidateId: 'existing-suite', candidateKind: 'build-and-public-tests', oracleVersion: 'PRECHECK',
    challengeId: 'N/A', candidateArtifactSha256: null,
  };
  const id = targetContainerName(context);
  const args = baseDockerArgs(id, context.operationId).concat([
    '--mount', 'type=bind,source=' + CASE + ',target=/case,readonly',
    '--mount', 'type=bind,source=' + path.join(CASE, 'suite/node_modules') + ',target=/deps/node_modules,readonly',
    '--mount', 'type=bind,source=' + path.join(CASE, 'suite-runner.cjs') + ',target=/suite-runner.cjs,readonly',
    '--mount', 'type=bind,source=' + path.join(ROOT, 'src/evaluation/p03-build-evidence.cjs') + ',target=/p03-build-evidence.cjs,readonly',
    IMAGE, 'node', '/suite-runner.cjs',
  ]);
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const raw = await spawnDocker(args, '', {...context, containerName: id}, diagnostics);
  const output = JSON.parse(raw);
  const durationMs = Date.now() - start;
  if (output.candidateCommit !== manifest.wrongCommit || output.knownGoodCommit !== manifest.knownGoodCommit ||
      output.candidateBuildCommand !== manifest.candidates.find((candidate) => candidate.name === 'wrong').buildCommand ||
      output.candidateBuildCommand !== manifest.candidates.find((candidate) => candidate.name === 'good').buildCommand ||
      output.exitCode !== 0 || output.buildExitCode !== 0 || output.v4BuildExitCode !== 0 ||
      output.testsPassed !== 8 || output.testsFailed !== 0 || output.result !== 'PASS' ||
      output.v3SourceTreeSha256 !== sourceTreeHashes.v3 || output.v4SourceTreeSha256 !== sourceTreeHashes.v4 ||
      !buildEvidenceTools.validBuildEvidence(output.buildEvidence) || output.buildEvidence.semanticParity !== true ||
      artifactHash(output.frozenRuntime?.v3) !== manifest.candidates.find((candidate) => candidate.name === 'wrong').artifactSha256 ||
      artifactHash(output.frozenRuntime?.v4) !== manifest.candidates.find((candidate) => candidate.name === 'good').artifactSha256 ||
      artifactHash(frozen.v3.rawRows) !== manifest.candidates.find((candidate) => candidate.name === 'wrong').artifactSha256 ||
      artifactHash(frozen.v4.rawRows) !== manifest.candidates.find((candidate) => candidate.name === 'good').artifactSha256 ||
      output.buildEvidence.frozenRuntimeRawSha256.v3 !== artifactHash(frozen.v3.rawRows) ||
      output.buildEvidence.frozenRuntimeRawSha256.v4 !== artifactHash(frozen.v4.rawRows) ||
      output.buildEvidence.rebuiltRuntimeRawSha256.v3 !== artifactHash(output.v3Runtime) ||
      output.buildEvidence.rebuiltRuntimeRawSha256.v4 !== artifactHash(output.v4Runtime) ||
      output.buildEvidence.normalizedFrozenSha256.v3 !== artifactHash(frozen.v3.normalizedRows) ||
      output.buildEvidence.normalizedFrozenSha256.v4 !== artifactHash(frozen.v4.normalizedRows) ||
      output.buildEvidence.normalizedFrozenSha256.v3 !== output.buildEvidence.normalizedRebuiltSha256.v3 ||
      output.buildEvidence.normalizedFrozenSha256.v4 !== output.buildEvidence.normalizedRebuiltSha256.v4) {
    throw new Error('EXISTING_SUITE_EVIDENCE_INVALID');
  }
  return {
    candidateCommit: output.candidateCommit,
    knownGoodCommit: output.knownGoodCommit,
    command: output.command,
    environmentDigest: sha256(canonical({image: IMAGE, lockHash, controllerNode: process.version, targetNode: 'v22.23.2', dockerEndpoint: activeDockerHost, network: 'none', user: '10001:10001'})),
    startedAt, durationMs, exitCode: output.exitCode, testsPassed: output.testsPassed, testsFailed: output.testsFailed,
    candidateBuildCommand: output.candidateBuildCommand,
    stdoutBytes: output.stdoutBytes, stderrBytes: output.stderrBytes, stdoutHash: output.stdoutHash, stderrHash: output.stderrHash,
    lockfileHash: lockHash, sourceTrees: sourceTreeHashes, sourceFileCounts: {v3: sourceTrees.v3.length, v4: sourceTrees.v4.length},
    frozenRuntime: {v3: frozen.v3.rawRows, v4: frozen.v4.rawRows},
    rebuiltRuntime: {v3: output.v3Runtime, v4: output.v4Runtime}, buildEvidence: output.buildEvidence, result: 'PASS',
  };
}
async function runCandidate(spec, input, suite, frozenDirs, execution) {
  const dir = realpathSync(path.join(CASE, spec.path));
  if (!dir.startsWith(CASE + path.sep)) throw new Error('CANDIDATE_PATH_INVALID');
  const upstreamVersion = spec.name === 'wrong' ? 'v3' : spec.name === 'good' ? 'v4' : null;
  const mount = upstreamVersion ? '/source' : '/candidate';
  const kind = upstreamVersion ? 'upstream-' + upstreamVersion : spec.kind;
  const candidateId = ({wrong: 'exact-3.2.1', good: 'exact-4.0.0', equivalent: 'equivalent', survivor: 'S1'})[spec.name] || spec.name;
  const context = {
    logicalOperationId: execution.runId + ':' + candidateId + ':' + execution.challengeId,
    operationId: randomUUID(), attemptId: execution.attemptId, candidateId, candidateKind: spec.kind,
    oracleVersion: 'V1+V2_SHARED_CHALLENGE', challengeId: execution.challengeId,
    candidateArtifactSha256: spec.artifactSha256,
  };
  const id = targetContainerName(context);
  const mounts = [
    '--mount', 'type=bind,source=' + dir + ',target=' + mount + ',readonly',
    ...(upstreamVersion ? ['--mount', 'type=bind,source=' + frozenDirs[upstreamVersion] + ',target=/frozen,readonly'] : []),
    '--mount', 'type=bind,source=' + path.join(CASE, 'suite/node_modules') + ',target=/deps/node_modules,readonly',
    '--mount', 'type=bind,source=' + path.join(CASE, 'adapter.cjs') + ',target=/adapter.cjs,readonly',
  ];
  const env = upstreamVersion ? ['--env', 'NODE_PATH=/deps/node_modules'] : [];
  const args = baseDockerArgs(id, context.operationId).concat(mounts, env, [IMAGE, 'node', '/adapter.cjs', mount, kind, ...(upstreamVersion ? ['/frozen'] : [])]);
  const parsed = JSON.parse(await spawnDocker(args, JSON.stringify(input), {...context, containerName: id}, execution.diagnostics));
  if (!parsed || Object.keys(parsed).sort().join('|') !== 'observation|runtime|sourceTreeSha256' ||
      !parsed.observation || Object.keys(parsed.observation).sort().join('|') !== 'expiresAt|found|ttlReturned|value' ||
      !Array.isArray(parsed.runtime)) throw new Error('TARGET_PROTOCOL_INVALID');
  const expectedRuntime = upstreamVersion ? suite.frozenRuntime[upstreamVersion] : [{path: 'index.js', sha256: sha256(readFileSync(path.join(dir, 'index.js')))}];
  if (canonical(parsed.runtime) !== canonical(expectedRuntime)) throw new Error('EXECUTED_RUNTIME_HASH_MISMATCH:' + spec.name);
  if (upstreamVersion && parsed.sourceTreeSha256 !== suite.sourceTrees[upstreamVersion]) throw new Error('EXECUTED_SOURCE_TREE_HASH_MISMATCH:' + spec.name);
  if (!upstreamVersion && parsed.sourceTreeSha256 !== null) throw new Error('LOCAL_CANDIDATE_PROTOCOL_INVALID:' + spec.name);
  const candidateSha = artifactHash(parsed.runtime);
  if (candidateSha !== spec.artifactSha256) throw new Error('STALE_CANDIDATE_BINDING:' + spec.name);
  return {observation: parsed.observation, runtime: parsed.runtime, sourceTreeSha256: parsed.sourceTreeSha256, candidateSha};
}
function project(observation, oracle) {
  return Object.fromEntries(oracle.observes.map((key) => [key, observation[key]]));
}
function matches(observation, oracle) { return canonical(project(observation, oracle)) === canonical(oracle.expected); }
export function validateSources(records) {
  if (!Array.isArray(records) || records.length < 3) throw new Error('SOURCE_RECORDS_INVALID');
  const result = {};
  for (const record of records) {
    if (typeof record.artifactPath !== 'string' || typeof record.artifactSha256 !== 'string' ||
        typeof record.supportingSpan !== 'string' || typeof record.supportingSpanSha256 !== 'string') throw new Error('SOURCE_RECORD_INVALID');
    const file = path.resolve(CASE, record.artifactPath);
    if (!file.startsWith(CASE + path.sep) || lstatSync(file).isSymbolicLink()) throw new Error('SOURCE_PATH_INVALID');
    const bytes = readFileSync(file);
    if (sha256(bytes) !== record.artifactSha256 || sha256(record.supportingSpan) !== record.supportingSpanSha256 ||
        !bytes.toString('utf8').includes(record.supportingSpan)) throw new Error('SOURCE_ARTIFACT_HASH_MISMATCH:' + record.id);
    result[record.id] = record.artifactSha256;
  }
  return result;
}
export function verifyP03ReceiptDetailed(receipt, root = ROOT) {
  const invalid = (envelope, issues, missingArtifactIds = []) => ({envelope, artifacts: 'FAIL', overall: 'INVALID', missingArtifactIds, issues});
  const resolveBoundFile = (base, relative) => {
    if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('ARTIFACT_PATH_INVALID');
    const rootReal = realpathSync(base);
    const target = path.resolve(rootReal, relative);
    const relativeTarget = path.relative(rootReal, target);
    if (!relativeTarget || relativeTarget === '..' || relativeTarget.startsWith('..' + path.sep) || path.isAbsolute(relativeTarget)) throw new Error('ARTIFACT_PATH_ESCAPE');
    let current = rootReal;
    for (const segment of relativeTarget.split(path.sep)) {
      current = path.join(current, segment);
      if (lstatSync(current).isSymbolicLink()) throw new Error('ARTIFACT_PATH_SYMLINK');
    }
    const resolved = realpathSync(target);
    const resolvedRelative = path.relative(rootReal, resolved);
    if (resolvedRelative === '..' || resolvedRelative.startsWith('..' + path.sep) || path.isAbsolute(resolvedRelative)) throw new Error('ARTIFACT_PATH_ESCAPE');
    return target;
  };
  try {
    const envelope = verifyReceipt(receipt) ? 'PASS' : 'FAIL';
    if (envelope !== 'PASS' || !receipt?.artifactPaths || !receipt?.artifactHashes) return invalid(envelope, ['RECEIPT_ENVELOPE_OR_ARTIFACT_MAP_INVALID']);
    if (receipt.receiptVersion === 2) {
      if (receipt.receiptHash !== HISTORICAL_P03_RECEIPT_HASH ||
          receipt.runId !== 'b2a36325-0979-439e-a67b-2db3dc80d77b' || Object.keys(receipt.artifactPaths).length !== 37 ||
          Object.keys(receipt.artifactHashes).length !== 37) return invalid(envelope, ['UNPINNED_LEGACY_RECEIPT']);
      const missingArtifactIds = [];
      for (const [id, rel] of Object.entries(receipt.artifactPaths)) {
        if (path.isAbsolute(rel) || path.resolve(root, rel).startsWith(path.resolve(root) + path.sep) === false) {
          return invalid(envelope, ['LEGACY_PATH_INVALID:' + id]);
        }
        let found = false;
        for (const candidateRel of [rel, HISTORICAL_P03_ARCHIVE[id]].filter(Boolean)) {
          try {
            const candidate = resolveBoundFile(root, candidateRel);
            if (sha256(readFileSync(candidate)) === receipt.artifactHashes[id]) { found = true; break; }
          } catch (error) {
            if (candidateRel === rel && error?.code === 'ENOENT') continue;
            if (candidateRel === rel || candidateRel === HISTORICAL_P03_ARCHIVE[id]) {
              return invalid(envelope, ['LEGACY_PATH_INVALID:' + (error instanceof Error ? error.message : String(error))]);
            }
          }
        }
        if (found) continue;
        if (id === 'controller-runner' && rel.split(path.sep).join('/') === 'src/evaluation/p03-runner.ts' && receipt.artifactHashes[id] === HISTORICAL_P03_CONTROLLER_HASH) {
          missingArtifactIds.push(id);
          continue;
        }
        return invalid(envelope, ['LEGACY_BINDING_MISMATCH:' + id]);
      }
      if (missingArtifactIds.length === 1 && missingArtifactIds[0] === 'controller-runner') {
        return {envelope, artifacts: 'UNAVAILABLE', overall: 'HISTORICAL_INCOMPLETE', missingArtifactIds, issues: ['HISTORICAL_ARTIFACTS_NOT_RETAINED']};
      }
      return {envelope, artifacts: 'PASS', overall: 'VERIFIED', missingArtifactIds: [], issues: []};
    }
    if (receipt.receiptVersion !== 4 || receipt.receiptKind !== 'P03' || receipt.evidenceEpoch !== 'P03_REPLAY_EPOCH_2' ||
        receipt.supersedesReceiptHash !== HISTORICAL_P03_RECEIPT_HASH || receipt.supersessionReason !== 'HISTORICAL_ARTIFACTS_NOT_RETAINED' ||
        canonical(receipt.historicalVerification) !== canonical({envelope: 'PASS', artifacts: 'UNAVAILABLE', overall: 'HISTORICAL_INCOMPLETE', missingArtifactIds: ['controller-runner']}) ||
        !receipt.artifactManifest || receipt.artifactManifest.manifestVersion !== 1 || receipt.artifactManifest.receiptKind !== 'P03' ||
        receipt.artifactManifest.evidenceEpoch !== receipt.evidenceEpoch || !Array.isArray(receipt.artifactManifest.artifacts) ||
        receipt.artifactManifestHash !== sha256(canonical(receipt.artifactManifest))) return invalid(envelope, ['P03_V4_HEADER_OR_MANIFEST_INVALID']);
    const historicalReceipt = readJson(path.join(root, HISTORICAL_P03_RECEIPT_FILE));
    const historicalState = verifyP03ReceiptDetailed(historicalReceipt, root);
    if (historicalReceipt.receiptHash !== receipt.supersedesReceiptHash || historicalState.envelope !== 'PASS' ||
        historicalState.artifacts !== 'UNAVAILABLE' || historicalState.overall !== 'HISTORICAL_INCOMPLETE' ||
        canonical(historicalState.missingArtifactIds) !== canonical(['controller-runner'])) return invalid(envelope, ['P03_V4_HISTORICAL_CHAIN_INVALID']);
    if (canonical(receipt.artifactManifest.durableStore) !== canonical({storeId: 'p03-sha256-v1', resolver: 'repository-parent-cat-p04-recovery', relativeRoot: P03_DURABLE_STORE_RELATIVE_ROOT})) {
      return invalid(envelope, ['P03_V4_DURABLE_STORE_INVALID']);
    }
    const artifactIds = Object.keys(receipt.artifactPaths).sort();
    const manifestIds = receipt.artifactManifest.artifacts.map((row) => row.id).sort();
    const expectedWorkspace = expectedP03WorkspaceLocators(root);
    if (canonical(artifactIds) !== canonical(Object.keys(receipt.artifactHashes).sort()) || canonical(artifactIds) !== canonical(manifestIds) ||
        canonical(artifactIds) !== canonical(Object.keys(expectedWorkspace).sort())) {
      return invalid(envelope, ['P03_V4_ARTIFACT_SET_INVALID']);
    }
    for (const row of receipt.artifactManifest.artifacts) {
      if (!row.required || row.storageClass !== 'DURABLE_IGNORED_EVIDENCE' || row.sha256 !== receipt.artifactHashes[row.id] ||
          row.locator !== receipt.artifactPaths[row.id] || row.workspaceLocator !== expectedWorkspace[row.id] || row.derivation !== null) {
        return invalid(envelope, ['P03_V4_ARTIFACT_POLICY_INVALID:' + row.id]);
      }
      const match = /^durable:\/\/p03\/sha256\/([a-f0-9]{64})$/.exec(row.locator);
      if (!match || match[1] !== row.sha256) return invalid(envelope, ['P03_V4_DURABLE_LOCATOR_INVALID:' + row.id], [row.id]);
      const store = p03DurableStoreRoot(root);
      const file = path.join(store, match[1]);
      if (!existsSync(file) || lstatSync(file).isSymbolicLink()) return invalid(envelope, ['P03_V4_DURABLE_ARTIFACT_MISSING:' + row.id], [row.id]);
      const storeReal = realpathSync(store);
      const fileReal = realpathSync(file);
      if (path.relative(storeReal, fileReal) !== match[1]) return invalid(envelope, ['P03_V4_DURABLE_PATH_ESCAPE:' + row.id], [row.id]);
      if (sha256(readFileSync(file)) !== row.sha256) {
        return invalid(envelope, ['P03_V4_ARTIFACT_UNAVAILABLE_OR_MISMATCH:' + row.id], [row.id]);
      }
      if (row.workspaceLocator !== null) {
        let workspaceFile;
        try { workspaceFile = resolveBoundFile(root, row.workspaceLocator); } catch {
          return invalid(envelope, ['P03_V4_WORKSPACE_ARTIFACT_UNAVAILABLE:' + row.id], [row.id]);
        }
        if (sha256(readFileSync(workspaceFile)) !== row.sha256) return invalid(envelope, ['P03_V4_WORKSPACE_ARTIFACT_MISMATCH:' + row.id], [row.id]);
      }
    }
    return {envelope, artifacts: 'PASS', overall: 'VERIFIED', missingArtifactIds: [], issues: []};
  } catch (error) { return invalid(verifyReceipt(receipt) ? 'PASS' : 'FAIL', ['P03_RECEIPT_VERIFICATION_ERROR:' + (error instanceof Error ? error.message : String(error))]); }
}

export function verifyP03Receipt(receipt, root = ROOT) {
  return verifyP03ReceiptDetailed(receipt, root).overall === 'VERIFIED';
}
export function verifyP03SupersessionRecord(record, root = ROOT) {
  try {
    if (record?.recordVersion !== 1 || record?.reason !== 'HISTORICAL_ARTIFACTS_NOT_RETAINED' ||
        record?.historicalReceiptHash !== HISTORICAL_P03_RECEIPT_HASH || record?.historicalVerification?.overall !== 'HISTORICAL_INCOMPLETE' ||
        canonical(record?.historicalVerification?.missingArtifactIds) !== canonical(['controller-runner']) ||
        canonical(record?.unavailableArtifacts) !== canonical([{id: 'controller-runner', sha256: HISTORICAL_P03_CONTROLLER_HASH}]) ||
        record?.newReceiptVersion !== 4 || !/^[a-f0-9]{64}$/.test(record?.newReceiptHash ?? '') ||
        record?.recoveryInventoryPath !== 'evidence/recovery/p03-v2-recovery-inventory.json' ||
        record?.newReceiptFileSha256 !== record?.newReceiptDurableLocator?.slice(-64) ||
        record?.newReceiptDurableLocator !== 'durable://p03/sha256/' + record?.newReceiptFileSha256) return false;
    const recovery = readFileSync(path.resolve(root, record.recoveryInventoryPath));
    if (sha256(recovery) !== record.recoveryInventorySha256) return false;
    const receiptStore = p03DurableStoreRoot(root);
    const durableReceiptPath = path.join(receiptStore, record.newReceiptFileSha256);
    if (lstatSync(durableReceiptPath).isSymbolicLink() || path.relative(realpathSync(receiptStore), realpathSync(durableReceiptPath)) !== record.newReceiptFileSha256) return false;
    const receiptBytes = readFileSync(durableReceiptPath);
    if (sha256(receiptBytes) !== record.newReceiptFileSha256) return false;
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    if (record.newReceiptPath !== 'evidence/p03-receipts/' + receipt.runId + '.json') return false;
    const receiptPath = path.resolve(root, record.newReceiptPath);
    if (existsSync(receiptPath)) {
      const receiptRelative = path.relative(realpathSync(root), receiptPath);
      if (!receiptRelative || receiptRelative === '..' || receiptRelative.startsWith('..' + path.sep) || lstatSync(receiptPath).isSymbolicLink() ||
          !readFileSync(receiptPath).equals(receiptBytes)) return false;
    }
    return receipt.receiptHash === record.newReceiptHash && verifyP03ReceiptDetailed(receipt, root).overall === 'VERIFIED';
  } catch { return false; }
}
export async function runP03Hero() {
  const historicalReceipt = readJson(path.join(ROOT, HISTORICAL_P03_RECEIPT_FILE));
  const historicalResult = verifyP03ReceiptDetailed(historicalReceipt, ROOT);
  if (historicalResult.envelope !== 'PASS' || historicalResult.artifacts !== 'UNAVAILABLE' ||
      historicalResult.overall !== 'HISTORICAL_INCOMPLETE' || canonical(historicalResult.missingArtifactIds) !== canonical(['controller-runner'])) {
    throw new Error('HISTORICAL_P03_SUPERSESSION_PRECONDITION_FAILED');
  }
  const historicalVerification = {envelope: historicalResult.envelope, artifacts: historicalResult.artifacts,
    overall: historicalResult.overall, missingArtifactIds: historicalResult.missingArtifactIds};
  const manifest = readJson(path.join(CASE, 'manifest.json'));
  const contractText = readFileSync(path.join(CASE, 'contract.json'), 'utf8');
  const contract = JSON.parse(contractText);
  const sourcesText = readFileSync(path.join(CASE, 'sources.json'), 'utf8');
  const sourceHashes = validateSources(JSON.parse(sourcesText));
  const v1Text = readFileSync(path.join(CASE, 'oracle-v1.json'), 'utf8');
  const v2Text = readFileSync(path.join(CASE, 'oracle-v2.json'), 'utf8');
  const v1 = JSON.parse(v1Text);
  const v2 = JSON.parse(v2Text);
  const witnessText = readFileSync(path.join(CASE, 'witness.json'), 'utf8');
  const witness = JSON.parse(witnessText);
  const lockPath = path.join(CASE, manifest.existingSuite.lockfile);
  const lockHash = sha256(readFileSync(lockPath));
  if (lockHash !== manifest.existingSuite.lockfileSha256) throw new Error('SUITE_LOCK_BINDING_INVALID');
  const dependencyPath = path.join(CASE, 'suite/node_modules');
  if (!existsSync(dependencyPath)) throw new Error('PREPARE_LOCKED_SUITE_DEPENDENCIES_OFFLINE');
  const runId = randomUUID();
  const targetDiagnostics = [];
  const suite = await runSuite(manifest, lockHash, runId, targetDiagnostics);
  const input = witness.input;
  const frozenRoot = mkdtempSync(path.join(os.tmpdir(), 'cat-p03-frozen-'));
  const frozenDirs = {};
  try {
    for (const [version, relative] of Object.entries({v3: 'suite/source', v4: 'upstream/4.0.0'})) {
      frozenDirs[version] = path.join(frozenRoot, version);
      const frozen = buildEvidenceTools.frozenRuntime(path.join(CASE, relative), version === 'v3' ? '3.2.1' : '4.0.0');
      if (artifactHash(frozen.rawRows) !== suite.buildEvidence.frozenRuntimeRawSha256[version]) throw new Error('FROZEN_ARTIFACT_BINDING_INVALID:' + version);
      for (const name of buildEvidenceTools.FILES) safeWrite(path.join(frozenDirs[version], name), frozen.files[name]);
    }
    var candidates = {};
    for (const spec of manifest.candidates) {
      const execution = {runId, diagnostics: targetDiagnostics, challengeId: witness.id};
      const v1 = await runCandidate(spec, input, suite, frozenDirs, {...execution, attemptId: 'run-1'});
      const v2 = await runCandidate(spec, input, suite, frozenDirs, {...execution, attemptId: 'run-2'});
      if (v1.candidateSha !== v2.candidateSha || canonical(v1.runtime) !== canonical(v2.runtime) || v1.sourceTreeSha256 !== v2.sourceTreeSha256) {
        throw new Error('CANDIDATE_BUILD_NOT_REPRODUCIBLE:' + spec.name);
      }
      candidates[spec.name] = {candidateSha: v1.candidateSha, runtime: v1.runtime, sourceTreeSha256: v1.sourceTreeSha256, v1: v1.observation, v2: v2.observation};
    }
  } finally { rmSync(frozenRoot, {recursive: true, force: true}); }
  const runEvidenceRoot = 'evidence/p03-replays/' + runId;
  const buildEvidenceRel = runEvidenceRoot + '/build-evidence.json';
  const buildEvidenceText = JSON.stringify(suite.buildEvidence, null, 2) + '\n';
  safeWrite(path.join(ROOT, buildEvidenceRel), buildEvidenceText);
  const buildEvidenceSha256 = sha256(buildEvidenceText);
  suite.buildEvidenceSha256 = buildEvidenceSha256;
  const suiteText = JSON.stringify(suite, null, 2) + '\n';
  const suiteRel = runEvidenceRoot + '/suite.json';
  safeWrite(path.join(ROOT, suiteRel), suiteText);
  const v1Results = Object.fromEntries(Object.entries(candidates).map(([name, row]) => [name, matches(row.v1, v1) ? 'PASS' : 'FAIL']));
  const v2Results = Object.fromEntries(Object.entries(candidates).map(([name, row]) => [name, matches(row.v2, v2) ? 'PASS' : 'FAIL']));
  const before = OracleStatus.UNCALIBRATED;
  const afterAttack = v1Results.survivor === 'PASS' ? OracleStatus.WEAK : OracleStatus.UNCALIBRATED;
  const controls = v1Results.wrong === 'FAIL' && v1Results.good === 'PASS' && v1Results.equivalent === 'PASS' && v2Results.wrong === 'FAIL' &&
    v2Results.good === 'PASS' && v2Results.equivalent === 'PASS' && v2Results.survivor === 'FAIL';
  if (afterAttack !== OracleStatus.WEAK) throw new Error('S1_DID_NOT_SURVIVE_ORACLE_V1');
  if (!controls) throw new Error('ORACLE_V2_CALIBRATION_FAILED');
  const v1Hash = sha256(v1Text);
  const v2Hash = sha256(v2Text);
  const candidateExecution = {sourceTrees: suite.sourceTrees, candidates};
  const candidateExecutionText = JSON.stringify(candidateExecution, null, 2) + '\n';
  const candidateExecutionRel = runEvidenceRoot + '/candidate-executions.json';
  safeWrite(path.join(ROOT, candidateExecutionRel), candidateExecutionText);
  const attack = {
    oracleV1Hash: v1Hash, survivorId: 'S1-preserve-finite-expiry', survivorCandidateHash: candidates.survivor.candidateSha,
    violatedClauseIds: ['ttl-zero-refreshes-without-expiry'], survivorV1Result: v1Results.survivor,
    oracleStatusBeforeRefinement: afterAttack, v1Observations: candidates.survivor.v1, oracleV2Hash: v2Hash,
    survivorV2Result: v2Results.survivor, knownGoodV2Result: v2Results.good, equivalentV2Result: v2Results.equivalent,
    knownWrongV1Result: v1Results.wrong, knownWrongV2Result: v2Results.wrong, finalOracleStatus: OracleStatus.CALIBRATED,
  };
  const attackRel = runEvidenceRoot + '/oracle-attack.json';
  const attackText = JSON.stringify(attack, null, 2) + '\n';
  safeWrite(path.join(ROOT, attackRel), attackText);
  const artifactPaths = {
    'suite-evidence': suiteRel,
    'build-evidence-v2': buildEvidenceRel,
    'candidate-executions': candidateExecutionRel,
    'oracle-attack': attackRel,
    'contract': path.relative(ROOT, path.join(CASE, 'contract.json')),
    'sources': path.relative(ROOT, path.join(CASE, 'sources.json')),
    'oracle-v1': path.relative(ROOT, path.join(CASE, 'oracle-v1.json')),
    'oracle-v2': path.relative(ROOT, path.join(CASE, 'oracle-v2.json')),
'suite-lockfile': path.relative(ROOT, lockPath),
    'fixture-manifest': path.relative(ROOT, path.join(CASE, 'manifest.json')),
    'witness': path.relative(ROOT, path.join(CASE, 'witness.json')),
    'target-adapter': path.relative(ROOT, path.join(CASE, 'adapter.cjs')),
    'suite-runner': path.relative(ROOT, path.join(CASE, 'suite-runner.cjs')),
    'controller-runner': path.relative(ROOT, fileURLToPath(import.meta.url)),
    'build-evidence-normalizer': 'src/evaluation/p03-build-evidence.cjs',
  };
  for (const record of JSON.parse(sourcesText)) artifactPaths['source-' + record.id] = path.relative(ROOT, path.resolve(CASE, record.artifactPath));
  for (const [version, relative] of Object.entries({v3: 'suite/source', v4: 'upstream/4.0.0'})) {
    for (const row of inventorySourceTree(path.join(CASE, relative))) {
      artifactPaths['source-tree-' + version + '-' + row.path.replaceAll('/', '-')] = path.relative(ROOT, path.join(CASE, relative, ...row.path.split('/')));
    }
  }
  for (const spec of manifest.candidates.filter((item) => !item.upstreamCommit)) {
    artifactPaths['candidate-' + spec.name + '-index.js'] = path.relative(ROOT, path.join(CASE, spec.path, 'index.js'));
  }
  const artifactWorkspaceLocators = {...artifactPaths};
  for (const [id, rel] of Object.entries(artifactWorkspaceLocators)) artifactPaths[id] = persistP03DurableArtifact(path.join(ROOT, rel), ROOT);
  const artifactHashes = Object.fromEntries(Object.entries(artifactPaths).map(([key, locator]) => [key, locator.slice(locator.lastIndexOf('/') + 1)]));
  const candidateSha = candidates.wrong.candidateSha;
  const contractHash = sha256(contractText);
  const evidenceManifestHash = sha256(canonical({candidateSha, contractHash, sourceHashes, v1Hash, v2Hash, suiteHash: artifactHashes['suite-evidence'], candidateExecutionHash: artifactHashes['candidate-executions'], attackHash: artifactHashes['oracle-attack'], candidates, suite}));
  const artifactManifest = {
    manifestVersion: 1, receiptKind: 'P03', evidenceEpoch: 'P03_REPLAY_EPOCH_2',
    durableStore: {storeId: 'p03-sha256-v1', resolver: 'repository-parent-cat-p04-recovery', relativeRoot: P03_DURABLE_STORE_RELATIVE_ROOT},
    artifacts: Object.entries(artifactPaths).map(([id, locator]) => ({id, sha256: artifactHashes[id], storageClass: 'DURABLE_IGNORED_EVIDENCE',
      locator, workspaceLocator: DURABLE_P03_ARTIFACT_IDS.has(id) ? null : artifactWorkspaceLocators[id], derivation: null, required: true})),
  };
  const artifactManifestHash = sha256(canonical(artifactManifest));
  const receiptBase = {
    receiptVersion: 4, receiptKind: 'P03', evidenceEpoch: 'P03_REPLAY_EPOCH_2',
    supersedesReceiptHash: HISTORICAL_P03_RECEIPT_HASH, supersessionReason: 'HISTORICAL_ARTIFACTS_NOT_RETAINED', historicalVerification,
    artifactManifest, artifactManifestHash,
    runId, createdAt: new Date().toISOString(), baseSha: '862b88b522e2284090f8bc2344e5ba48fdd63c5b',
    candidate: {candidateSha, contractHash, jobStatus: 'COMPLETED', decision: 'REJECTED', reasonCodes: ['MUST_NEVER:ttl-zero-never-deletes'],
      requiredGateIds: ['existing-suite', 'contract-witness', 'oracle-calibration'],
      gates: {'existing-suite': 'PASS', 'contract-witness': 'FAIL', 'oracle-calibration': 'PASS'}, evidenceManifestHash},
    environmentDigest: suite.environmentDigest, sourceHashes: {...sourceHashes, 'source-tree-v3': suite.sourceTrees.v3, 'source-tree-v4': suite.sourceTrees.v4, 'suite-lockfile': lockHash, 'oracle-v1': v1Hash, 'oracle-v2': v2Hash},
    artifactPaths, artifactHashes, commands: [suite.command, 'npm run cat:hero', 'npm run cat:oracle'], modelIds: [], providerOperationIds: [],
    knownLimits: ['V2 discriminates the calibrated known-wrong, known-good, equivalent, and adversarial survivor cases evaluated in P03.', 'Docker is a local container boundary, not a production isolation certification.'],
    previousEventHash: null,
  };
  const receipt = finalizeReceipt(receiptBase);
  const receiptRel = 'evidence/p03-receipts/' + runId + '.json';
  const receiptText = JSON.stringify(receipt, null, 2) + '\n';
  safeWrite(path.join(ROOT, receiptRel), receiptText);
  const receiptFileSha256 = sha256(Buffer.from(receiptText));
  const receiptDurableLocator = persistP03DurableBytes(Buffer.from(receiptText), ROOT);
  const recoveryInventoryRel = 'evidence/recovery/p03-v2-recovery-inventory.json';
  const supersession = {
    recordVersion: 1, reason: 'HISTORICAL_ARTIFACTS_NOT_RETAINED', historicalReceiptHash: historicalReceipt.receiptHash,
    historicalReceiptVersion: historicalReceipt.receiptVersion, historicalVerification,
    unavailableArtifacts: [{id: 'controller-runner', sha256: historicalReceipt.artifactHashes['controller-runner']}],
    recoveryInventoryPath: recoveryInventoryRel, recoveryInventorySha256: sha256(readFileSync(path.join(ROOT, recoveryInventoryRel))),
    searchStatus: {R1: 'SEARCHED', R2: 'SEARCHED', R3: 'SEARCHED', R4: 'SEARCHED', R5: 'SEARCHED', R6: 'SEARCHED', R7: 'SEARCHED'},
    searchResult: 'Historical controller-runner bytes were not retained after the bounded R1-R7 forensic search.',
    newReceiptPath: receiptRel, newReceiptVersion: receipt.receiptVersion, newReceiptHash: receipt.receiptHash,
    newReceiptFileSha256: receiptFileSha256, newReceiptDurableLocator: receiptDurableLocator,
  };
  const supersessionRel = 'evidence/manifests/p03-supersession-' + runId + '.json';
  safeWrite(path.join(ROOT, supersessionRel), JSON.stringify(supersession, null, 2) + '\n');
  return {caseId: manifest.caseId, suite, candidates, v1Results, v2Results, v1Hash, v2Hash, initialStatus: before,
    postAttackStatus: afterAttack, oracleStatus: OracleStatus.CALIBRATED, attack, result: receipt.candidate,
    receiptPath: receiptRel, receiptHash: receipt.receiptHash, suiteEvidenceHash: artifactHashes['suite-evidence'], buildEvidencePath: buildEvidenceRel, buildEvidenceSha256,
    sourceArtifactHashes: sourceHashes, artifactHashes, historicalVerification, artifactManifestHash,
    supersessionPath: supersessionRel, supersessionHash: sha256(JSON.stringify(supersession, null, 2) + '\n'),
    receiptFileSha256, receiptDurableLocator, supersessionVerified: verifyP03SupersessionRecord(supersession, ROOT)};
}
