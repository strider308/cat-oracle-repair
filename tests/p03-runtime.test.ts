import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import test from 'node:test';
import {captureTargetChild, runP03TargetLifecycle} from '../src/evaluation/p03-runner.ts';
import {decideFinal} from '../src/verifier/sealed-verifier.ts';

const IMAGE = 'sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32';
const validId = 'a'.repeat(64);
const asBuffer = (value = '') => Buffer.from(value);
const commandResult = (exitCode, stdout = '', stderr = '') => ({
  exitCode, signal: null, stdout: asBuffer(stdout), stderr: asBuffer(stderr),
  stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr),
  timedOut: false, outputLimited: false, spawnErrorCode: null,
});
const stateJson = (overrides = {}) => JSON.stringify({
  Status: 'exited', Running: false, Paused: false, Restarting: false, OOMKilled: false, Dead: false,
  Pid: 0, ExitCode: 0, Error: '', StartedAt: '2026-10-07T00:00:00Z', FinishedAt: '2026-10-07T00:00:01Z',
  ...overrides,
});
function lifecycleArgs(name, operationId, commandText = "process.stdout.write('ok')") {
  return ['create', '--pull=never', '-i', '--label', 'com.cat.p03.operation=' + operationId, '--name', name,
    '--network', 'none', '--read-only', '--pids-limit', '64', '--memory', '256m', '--cpus', '1',
    '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', IMAGE, 'node', '-e', commandText];
}
function lifecycleContext(candidateId = 'test-candidate') {
  const operationId = randomUUID();
  const context = {
    logicalOperationId: 'logical-test:' + candidateId + ':challenge-test', operationId, attemptId: 'attempt-1',
    candidateId, candidateKind: 'test-only', oracleVersion: 'V1+V2', challengeId: 'challenge-test',
    candidateArtifactSha256: '0'.repeat(64),
  };
  context.containerName = 'cat-p03-test-' + candidateId + '-' + operationId.slice(0, 8);
  return context;
}
function fakeLifecycle(runOverrides = {}) {
  const events = [];
  const runCommand = async (args) => {
    events.push(args[0] === 'container' ? 'VERIFY_REMOVED' : args[0].toUpperCase());
    const action = events.at(-1);
    if (action === 'CREATE') return commandResult(0, validId + '\n');
    if (action === 'START') return commandResult(0, 'target output');
    if (action === 'INSPECT') return commandResult(0, stateJson());
    if (action === 'RM') return commandResult(0);
    if (action === 'VERIFY_REMOVED') return commandResult(0);
    return commandResult(1, '', 'unexpected command');
  };
  return {events, runCommand: async (args, options) => {
    const result = await runCommand(args, options);
    return runOverrides[args[0] === 'inspect' ? 'inspect' : args[0]] || result;
  }};
}

const context = {
  logicalOperationId: 'run-test:TEST_ONLY_TARGET:challenge-test',
  operationId: 'operation-test',
  attemptId: 'attempt-test',
  candidateId: 'TEST_ONLY_TARGET',
  candidateKind: 'test-child',
  oracleVersion: 'TEST',
  challengeId: 'challenge-test',
  candidateArtifactSha256: '0'.repeat(64),
  dockerExecutable: 'TEST_ONLY_NODE',
  dockerArgs: ['node', '-e', '<TEST_SCRIPT>'],
  dockerArgsSha256: '1'.repeat(64),
  mountIdentifiers: [],
  containerName: 'cat-test-only',
  startedAt: '2026-10-07T00:00:00.000Z',
};

test('failed target child keeps bounded stdout, stderr, identity, exit, and cleanup diagnostics', async () => {
  let cleanupCalls = 0;
  const child = spawn(process.execPath, ['-e', "process.stdout.write('target stdout');process.stderr.write('target stderr');process.exit(1)"], {stdio: ['pipe', 'pipe', 'pipe']});
  const result = await captureTargetChild(child, context, {
    timeoutMs: 5000,
    terminate: () => child.kill(),
    finalize: () => { cleanupCalls++; return {containerId: 'abcdef123456', cleanupResult: 'PASS', cleanupDetails: {removed: true}}; },
  });
  assert.equal(result.diagnostic.status, 'PROCESS_ERROR');
  assert.equal(result.diagnostic.reason, 'NONZERO_EXIT');
  assert.equal(result.diagnostic.candidateId, 'TEST_ONLY_TARGET');
  assert.equal(result.diagnostic.exitCode, 1);
  assert.equal(result.diagnostic.stdoutTail, 'target stdout');
  assert.equal(result.diagnostic.stderrTail, 'target stderr');
  assert.equal(result.diagnostic.timedOut, false);
  assert.equal(result.diagnostic.cleanupResult, 'PASS');
  assert.equal(cleanupCalls, 1);
  assert.ok(Buffer.byteLength(result.diagnostic.stdoutTail) <= 4096);
  assert.ok(Buffer.byteLength(result.diagnostic.stderrTail) <= 4096);
});

test('target timeout is an operational failure and still runs cleanup', async () => {
  let cleanupCalls = 0;
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: ['pipe', 'pipe', 'pipe']});
  const result = await captureTargetChild(child, context, {
    timeoutMs: 50,
    terminate: () => child.kill(),
    finalize: () => { cleanupCalls++; return {cleanupResult: 'PASS', cleanupDetails: {removed: true}}; },
  });
  assert.equal(result.diagnostic.status, 'TIMEOUT');
  assert.equal(result.diagnostic.timedOut, true);
  assert.equal(result.diagnostic.cleanupResult, 'PASS');
  assert.equal(cleanupCalls, 1);
  assert.equal(decideFinal({publicPass: true, holdoutStatus: 'UNAVAILABLE', operationalError: true}), 'INCONCLUSIVE');
});

test('target output tails remain byte bounded after oversized output', async () => {
  const child = spawn(process.execPath, ['-e', "process.stdout.write('x'.repeat(6000));process.stderr.write('y'.repeat(6000))"], {stdio: ['pipe', 'pipe', 'pipe']});
  const result = await captureTargetChild(child, context, {
    timeoutMs: 5000,
    terminate: () => child.kill(),
    finalize: () => ({cleanupResult: 'PASS', cleanupDetails: {removed: true}}),
  });
  assert.equal(result.diagnostic.reason, 'OUTPUT_LIMIT');
  assert.ok(result.diagnostic.stdoutBytes > 4096);
  assert.ok(Buffer.byteLength(result.diagnostic.stderrTail) <= 4096);
  assert.ok(Buffer.byteLength(result.diagnostic.stdoutTail) <= 4096);
  assert.ok(Buffer.byteLength(result.diagnostic.stderrTail) <= 4096);
});

test('target output tails remain byte bounded when UTF-8 is cut at the byte limit', async () => {
  const child = spawn(process.execPath, ['-e', "process.stdout.write('😀'.repeat(1500))"], {stdio: ['pipe', 'pipe', 'pipe']});
  const result = await captureTargetChild(child, context, {
    timeoutMs: 5000,
    terminate: () => child.kill(),
    finalize: () => ({cleanupResult: 'PASS'}),
  });
  assert.equal(result.diagnostic.reason, 'OUTPUT_LIMIT');
  assert.ok(Buffer.byteLength(result.diagnostic.stdoutTail) <= 4096);
});

test('managed Docker lifecycle inspects before removal and preserves sandbox flags', async () => {
  const context = lifecycleContext();
  const args = lifecycleArgs(context.containerName, context.operationId);
  const fake = fakeLifecycle();
  const result = await runP03TargetLifecycle(args, '', context, {runCommand: fake.runCommand});
  assert.deepEqual(fake.events, ['CREATE', 'START', 'INSPECT', 'RM', 'VERIFY_REMOVED']);
  assert.equal(result.diagnostic.containerExitCode, 0);
  assert.equal(result.diagnostic.cleanupResult, 'PASS');
  assert.equal(result.diagnostic.containerRemovalVerified, true);
  for (const flag of ['--pull=never', '-i', '--network', '--read-only', '--pids-limit', '--memory', '--cpus', '--user', '--cap-drop', '--security-opt', '--tmpfs']) {
    assert.ok(args.includes(flag), 'missing preserved sandbox flag ' + flag);
  }
});

test('create failure remains inconclusive and never starts or removes an unidentified container', async () => {
  const context = lifecycleContext();
  const events = [];
  const runCommand = async (args) => {
    events.push(args[0] === 'container' ? 'RECOVER_LABEL' : args[0].toUpperCase());
    return args[0] === 'container' ? commandResult(0) : commandResult(125, '', 'create failed');
  };
  const result = await runP03TargetLifecycle(lifecycleArgs(context.containerName, context.operationId), '', context, {runCommand});
  assert.deepEqual(events, ['CREATE', 'RECOVER_LABEL']);
  assert.equal(result.diagnostic.reason, 'CREATE_FAILURE');
  assert.equal(result.diagnostic.containerId, null);
  assert.equal(result.diagnostic.cleanupAttempted, false);
});

test('inspect failure suppresses semantics but still removes and verifies the exact container', async () => {
  const context = lifecycleContext();
  const fake = fakeLifecycle({inspect: commandResult(1, '', 'inspect failed')});
  const result = await runP03TargetLifecycle(lifecycleArgs(context.containerName, context.operationId), '', context, {runCommand: fake.runCommand});
  assert.equal(result.diagnostic.reason, 'INSPECT_FAILURE');
  assert.equal(result.diagnostic.containerExitCode, null);
  assert.equal(result.diagnostic.cleanupResult, 'PASS');
  assert.deepEqual(fake.events, ['CREATE', 'START', 'INSPECT', 'RM', 'VERIFY_REMOVED']);
});

test('cleanup failure suppresses semantic output even when removal appears absent', async () => {
  const context = lifecycleContext();
  const fake = fakeLifecycle({rm: commandResult(1, '', 'remove failed')});
  const result = await runP03TargetLifecycle(lifecycleArgs(context.containerName, context.operationId), '', context, {runCommand: fake.runCommand});
  assert.equal(result.diagnostic.containerRemovalVerified, true);
  assert.equal(result.diagnostic.cleanupResult, 'FAIL');
  assert.equal(result.diagnostic.reason, 'CLEANUP_FAILURE');
});

test('inspected exit code is authoritative when Docker client exit disagrees', async () => {
  const context = lifecycleContext();
  const fake = fakeLifecycle({inspect: commandResult(0, stateJson({ExitCode: 17}))});
  const result = await runP03TargetLifecycle(lifecycleArgs(context.containerName, context.operationId), '', context, {runCommand: fake.runCommand});
  assert.equal(result.diagnostic.dockerClientExitCode, 0);
  assert.equal(result.diagnostic.containerExitCode, 17);
  assert.equal(result.diagnostic.reason, 'DOCKER_EXIT_MISMATCH');
});

function runRealTarget(script, options = {}) {
  const context = lifecycleContext(options.candidateId || 'real-docker');
  const args = lifecycleArgs(context.containerName, context.operationId, script);
  return runP03TargetLifecycle(args, '', context, options);
}

test('real Docker success inspects exit zero and verifies removal', async () => {
  const result = await runRealTarget("process.stdout.write('docker-ok')");
  assert.equal(result.diagnostic.reason, null);
  assert.equal(result.diagnostic.containerExitCode, 0);
  assert.equal(result.stdout.toString('utf8'), 'docker-ok');
  assert.equal(result.diagnostic.cleanupResult, 'PASS');
  assert.equal(result.diagnostic.containerRemovalVerified, true);
});

test('real Docker nonzero exit retains both output markers and stays operationally inconclusive', async () => {
  const result = await runRealTarget("process.stdout.write('stdout-marker');process.stderr.write('stderr-marker');process.exit(17)");
  assert.equal(result.diagnostic.containerExitCode, 17);
  assert.equal(result.diagnostic.stdoutTail, 'stdout-marker');
  assert.equal(result.diagnostic.stderrTail, 'stderr-marker');
  assert.equal(result.diagnostic.timedOut, false);
  assert.equal(result.diagnostic.cleanupResult, 'PASS');
  assert.equal(result.diagnostic.containerRemovalVerified, true);
  assert.equal(result.diagnostic.reason, 'NONZERO_EXIT');
  assert.equal(decideFinal({publicPass: true, holdoutStatus: 'UNAVAILABLE', operationalError: true}), 'INCONCLUSIVE');
});

test('real Docker timeout kills synchronously, inspects, removes, and verifies absence', async () => {
  const result = await runRealTarget('setInterval(() => {}, 1000)', {timeoutMs: 1000});
  assert.equal(result.diagnostic.timedOut, true);
  assert.ok(result.diagnostic.dockerState);
  assert.equal(result.diagnostic.cleanupAttempted, true);
  assert.equal(result.diagnostic.cleanupResult, 'PASS');
  assert.equal(result.diagnostic.containerRemovalVerified, true);
  assert.equal(result.diagnostic.reason, 'TIMEOUT');
});

test('real Docker oversized output is bounded and the container is removed', async () => {
  const result = await runRealTarget("process.stdout.write('x'.repeat(12000))");
  assert.ok(result.diagnostic.stdoutBytes > 4096);
  assert.ok(Buffer.byteLength(result.diagnostic.stdoutTail) <= 4096);
  assert.equal(result.diagnostic.reason, 'OUTPUT_LIMIT');
  assert.equal(result.diagnostic.cleanupResult, 'PASS');
  assert.equal(result.diagnostic.containerRemovalVerified, true);
});

test('real Docker run does not collide with or remove an unrelated CAT-like stale container', async () => {
  const name = 'cat-p03-stale-test-' + randomUUID().slice(0, 12);
  const stale = spawnSync('docker', ['create', '--pull=never', '-i', '--name', name, '--network', 'none', '--read-only',
    '--pids-limit', '64', '--memory', '256m', '--cpus', '1', '--user', '10001:10001', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', IMAGE, 'node', '-e', 'process.exit(0)'],
  {encoding: 'utf8', timeout: 30000, windowsHide: true});
  assert.equal(stale.status, 0, stale.stderr);
  const staleId = stale.stdout.trim();
  try {
    const result = await runRealTarget("process.stdout.write('no-collision')");
    assert.equal(result.diagnostic.reason, null);
    assert.notEqual(result.diagnostic.containerId, staleId);
    const stillExists = spawnSync('docker', ['inspect', '--format={{.Id}}', staleId], {encoding: 'utf8', timeout: 10000, windowsHide: true});
    assert.equal(stillExists.status, 0, stillExists.stderr);
    assert.equal(stillExists.stdout.trim(), staleId);
  } finally {
    const removed = spawnSync('docker', ['rm', '-f', staleId], {encoding: 'utf8', timeout: 10000, windowsHide: true});
    assert.equal(removed.status, 0, removed.stderr);
  }
});
