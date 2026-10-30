import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {canonical} from '../src/oracle/canonical.ts';
import {createTestRepairLifecycle, hashCandidateTree} from '../src/repair/lifecycle.ts';
import {applyRepairProposal} from '../src/repair/candidate.ts';
import {createRepairRequestPackage, REPAIR_MODIFIABLE_PATH, REPAIR_RESPONSE_SCHEMA, validateRepairProposal, verifyRepairRequestContext} from '../src/repair/model-response.ts';
import {APPROVED_REPAIR_MODEL_ID, MAX_REPAIR_PACKAGE_BYTES, requestRepairProposal, selectRepairModel} from '../src/repair/provider.ts';
import {createV5EvidenceStore, verifyV5Receipt, withinExecutionClockEnvelope} from '../src/repair/receipt-v5.ts';
import {createRepairLifecycle, hashRepairTree, type GateEvidence, type RepairBackend} from '../src/repair/production-lifecycle.ts';
import {selectRepairExecutionBackend} from '../src/repair/execution.ts';
import {createRepairExecutionPlan, createRepairProjection, normalizeProjectionPath, resolveAllowlistedSource, SENSITIVE_ARTIFACT_DENYLIST, validateProjectionPaths, workspaceHashForFiles} from '../src/repair/repair-projection.ts';
import {decideFinal} from '../src/verifier/sealed-verifier.ts';
import {assertP05ImplementationBinding, P05_IMPLEMENTATION_FILES, type ImplementationSource} from '../src/repair/implementation-binding.ts';
import {assertP05ImplementationBindingV2, P05_SUCCESSOR_IMPLEMENTATION_FILES, prepareP05ImplementationBindingV2, type P05SuccessorSource} from '../src/repair/implementation-binding-v2.ts';
import {deriveBlindSemanticResult, deriveP05Outcome, type P05EvidenceFacts} from '../src/repair/milestone.ts';

const root = path.resolve(import.meta.dirname, '..');
const hash = (char: string) => char.repeat(64);

function fakeImplementationSource(overrides: {working?: string; untracked?: string[]; untrackedFile?: string; missingTracked?: string; absent?: string} = {}) {
  const contents = new Map<string, Buffer>(P05_IMPLEMENTATION_FILES.map((file) => [file, Buffer.from(`committed:${file}`)]));
  const tracked = new Set(P05_IMPLEMENTATION_FILES);
  if (overrides.working) contents.set(overrides.working, Buffer.from('modified'));
  if (overrides.missingTracked) tracked.delete(overrides.missingTracked);
  if (overrides.absent) contents.delete(overrides.absent);
  const untracked = [...(overrides.untracked ?? [])];
  if (overrides.untrackedFile) untracked.push(overrides.untrackedFile);
  const source: ImplementationSource = {
    head: () => 'a'.repeat(40), tree: () => 'b'.repeat(40), branch: () => 'hackathon/nebius-nvidia-cat-r5-20261006',
    remoteHead: () => 'a'.repeat(40), isTracked: (file) => tracked.has(file),
    committedBytes: (_head, file) => tracked.has(file) ? Buffer.from(`committed:${file}`) : null,
    workingBytes: (file) => contents.get(file) ?? null,
    untrackedPaths: () => untracked,
  };
  return source;
}

test('implementation binding accepts only committed working source and ignores unrelated artifacts', () => {
  const binding = assertP05ImplementationBinding(fakeImplementationSource({untracked: ['.gortex/cache.json']}), 'hackathon/nebius-nvidia-cat-r5-20261006');
  assert.equal(binding.implementationSha, 'a'.repeat(40));
  assert.equal(binding.implementationTreeSha, 'b'.repeat(40));
  assert.equal(binding.implementationFiles.length, P05_IMPLEMENTATION_FILES.length);
  assert.ok(binding.implementationFiles.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
});

test('repair model selector remains in the existing P05 runtime closure', () => {
  assert.ok(P05_IMPLEMENTATION_FILES.includes('src/repair/provider.ts'));
  assert.ok(P05_IMPLEMENTATION_FILES.includes('src/runtime/nebius.ts'));
  assert.ok(P05_IMPLEMENTATION_FILES.includes('scripts/cat-repair.ts'));
  assert.equal(existsSync(path.join(root, 'src/repair/model-selection.ts')), false);
  assert.equal(selectRepairModel([{id: APPROVED_REPAIR_MODEL_ID}]).id, APPROVED_REPAIR_MODEL_ID);
  assert.throws(() => selectRepairModel([{id: 'nvidia/nemotron-3.5-lightning'}]), /NO_APPROVED_LIVE_NVIDIA_NEMOTRON_MODEL/);
});

test('cat-repair terminal catches share the typed failure-code resolver', () => {
  const source = readFileSync(path.join(root, 'scripts/cat-repair.ts'), 'utf8');
  assert.equal(source.match(/resolveTokenFactoryFailureCode\(error\)/g)?.length, 2);
  assert.doesNotMatch(source, /error instanceof Error && \/\^\[A-Z0-9_:-\]\{1,100\}\$\/\.test\(error\.message\)/);
});

test('implementation binding rejects modified, untracked, shadowing, and absent implementation source', () => {
  assert.throws(() => assertP05ImplementationBinding(fakeImplementationSource({working: P05_IMPLEMENTATION_FILES[0]}), 'hackathon/nebius-nvidia-cat-r5-20261006'), /IMPLEMENTATION_FILE_MODIFIED/);
  assert.throws(() => assertP05ImplementationBinding(fakeImplementationSource({untrackedFile: 'src/repair/shadow.ts'}), 'hackathon/nebius-nvidia-cat-r5-20261006'), /IMPLEMENTATION_UNTRACKED_SHADOW/);
  assert.throws(() => assertP05ImplementationBinding(fakeImplementationSource({missingTracked: P05_IMPLEMENTATION_FILES[1]}), 'hackathon/nebius-nvidia-cat-r5-20261006'), /IMPLEMENTATION_FILE_UNTRACKED/);
  assert.throws(() => assertP05ImplementationBinding(fakeImplementationSource({absent: P05_IMPLEMENTATION_FILES[1]}), 'hackathon/nebius-nvidia-cat-r5-20261006'), /IMPLEMENTATION_FILE_MISSING/);
  assert.throws(() => assertP05ImplementationBinding(fakeImplementationSource(), 'other-branch'), /IMPLEMENTATION_BRANCH_MISMATCH/);
});

function fakeSuccessorSource(overrides: {clean?: boolean; remoteHead?: string; branch?: string; remoteUrl?: string} = {}): P05SuccessorSource {
  const files = [...P05_SUCCESSOR_IMPLEMENTATION_FILES];
  const source: P05SuccessorSource = {
    head: () => 'a'.repeat(40), tree: () => 'b'.repeat(40), branch: () => overrides.branch ?? 'codex/cat-sprint7-competition-release',
    remoteHead: () => 'a'.repeat(40), remoteHeadFor: () => overrides.remoteHead ?? 'a'.repeat(40),
    remoteUrl: () => overrides.remoteUrl ?? 'https://example.invalid/cat.git', workingTreeClean: () => overrides.clean ?? true,
    isTracked: (file) => files.includes(file as typeof files[number]),
    committedBytes: (_head, file) => files.includes(file as typeof files[number]) ? Buffer.from(`committed:${file}`) : null,
    workingBytes: (file) => files.includes(file as typeof files[number]) ? Buffer.from(`committed:${file}`) : null,
    untrackedPaths: () => [],
  };
  return source;
}

test('P05 successor binding requires clean source, matching remote authority, and exact owner approval', () => {
  const source = fakeSuccessorSource();
  const binding = prepareP05ImplementationBindingV2(source, root, 'origin');
  assert.equal(binding.version, 2);
  assert.equal(binding.branch, 'codex/cat-sprint7-competition-release');
  assert.equal(binding.implementationFiles.length, P05_SUCCESSOR_IMPLEMENTATION_FILES.length);
  assert.throws(() => assertP05ImplementationBindingV2(source, root, 'origin', null), /IMPLEMENTATION_V2_OWNER_APPROVAL_REQUIRED/);
  const approval = {...binding, status: 'approved', ownerReference: 'human-owner', approvedAt: new Date().toISOString()};
  assert.deepEqual(assertP05ImplementationBindingV2(source, root, 'origin', approval), binding);
  assert.throws(() => assertP05ImplementationBindingV2(source, root, 'origin', {...approval, sourceSha: 'f'.repeat(40)}), /IMPLEMENTATION_V2_OWNER_APPROVAL_MISMATCH/);
});

test('P05 successor binding rejects dirty trees and a remote head that differs from source', () => {
  assert.throws(() => prepareP05ImplementationBindingV2(fakeSuccessorSource({clean: false}), root, 'origin'), /IMPLEMENTATION_V2_DIRTY_TREE/);
  assert.throws(() => prepareP05ImplementationBindingV2(fakeSuccessorSource({remoteHead: 'c'.repeat(40)}), root, 'origin'), /IMPLEMENTATION_V2_REMOTE_AUTHORITY_MISMATCH/);
});

const passingPublicOutcomes = ['build', 'existing-suite', 'public-contract', 'public-oracle-v2'].map((gate) => ({gate, result: 'PASS', exitCode: 0}));
function outcomeInput(overrides: Partial<P05EvidenceFacts> = {}): P05EvidenceFacts {
  return {publicOutcomes: passingPublicOutcomes.map((gate) => ({...gate, failureKind: 'NONE' as const, reasonCode: null})),
    blindOutcome: 'PASS', candidateHash: hash('a'), freezeValid: true, holdoutValid: true, lifecycleValid: true,
    modelEvidenceValid: true, backend: 'LOCAL_DOCKER_FALLBACK', executionEvidenceValid: true, sandboxBlockerValid: true,
    receiptDurable: true, ...overrides};
}

test('P05 candidate result, experiment integrity, and milestone are separate for valid blind outcomes', () => {
  const accepted = deriveP05Outcome(outcomeInput());
  assert.deepEqual(accepted, {blindOutcome: 'PASS', executionBackend: 'LOCAL_DOCKER_FALLBACK',
    candidateResult: {jobStatus: 'COMPLETED', decision: 'ACCEPTED', reasonCodes: ['ALL_GATES_PASS']},
    experimentIntegrity: 'PASS', milestone: 'CAT_P05S_SPONSOR_PASS_SANDBOX_BLOCKED', candidateAccepted: true});
  const rejected = deriveP05Outcome(outcomeInput({blindOutcome: 'FAIL'}));
  assert.equal(rejected.candidateResult.decision, 'REJECTED');
  assert.equal(rejected.experimentIntegrity, 'PASS');
  assert.equal(rejected.milestone, 'CAT_P05S_SPONSOR_PASS_SANDBOX_BLOCKED');
});

test('P05 public semantic rejection and operational failure have distinct incomplete results', () => {
  const publicRejected = deriveP05Outcome(outcomeInput({blindOutcome: 'NOT_RUN',
    publicOutcomes: passingPublicOutcomes.map((gate, index) => ({...gate, result: index === 2 ? 'FAIL' : gate.result,
      failureKind: index === 2 ? 'SEMANTIC' as const : 'NONE' as const, reasonCode: index === 2 ? 'PUBLIC_CONTRACT_FAILURE' : null}))}));
  assert.equal(publicRejected.candidateResult.decision, 'REJECTED');
  assert.deepEqual(publicRejected.candidateResult.reasonCodes, ['PUBLIC_CONTRACT_FAILURE']);
  assert.equal(publicRejected.experimentIntegrity, 'INCOMPLETE');
  assert.equal(publicRejected.milestone, 'CAT_P05S_BLOCKED');
  const operational = deriveP05Outcome(outcomeInput({blindOutcome: 'INCONCLUSIVE'}));
  assert.equal(operational.candidateResult.decision, null);
  assert.equal(operational.experimentIntegrity, 'INCOMPLETE');
  assert.equal(operational.milestone, 'CAT_P05S_BLOCKED');
  assert.equal(operational.candidateResult.jobStatus, 'INCONCLUSIVE');
  assert.equal(operational.candidateAccepted, false);
});

test('production and receipt verification share blind observation semantics', () => {
  const challenge = {value: 'expected', updatedTtlSeconds: 30};
  assert.equal(deriveBlindSemanticResult(challenge, {ttlReturned: true, found: true, value: 'expected', expiresAt: 10500}, 10000, 11000), 'SEMANTIC_PASS');
  assert.equal(deriveBlindSemanticResult(challenge, {ttlReturned: true, found: true, value: 'wrong', expiresAt: 10500}, 10000, 11000), 'SEMANTIC_FAIL');
});

test('P05 milestone matrix does not claim sponsor pass for public rejection and accepts backend provenance', () => {
  const nebiusReject = deriveP05Outcome(outcomeInput({backend: 'NEBIUS_SANDBOX', blindOutcome: 'FAIL', sandboxBlockerValid: false}));
  assert.equal(nebiusReject.milestone, 'CAT_P05S_PASS');
  assert.equal(nebiusReject.candidateResult.decision, 'REJECTED');
  const localReject = deriveP05Outcome(outcomeInput({blindOutcome: 'FAIL'}));
  assert.equal(localReject.milestone, 'CAT_P05S_SPONSOR_PASS_SANDBOX_BLOCKED');
  const publicReject = deriveP05Outcome(outcomeInput({publicOutcomes: passingPublicOutcomes.map((gate, index) => ({...gate,
    result: index === 0 ? 'FAIL' : 'PASS', failureKind: index === 0 ? 'SEMANTIC' as const : 'NONE' as const,
    reasonCode: index === 0 ? 'PUBLIC_BUILD_SEMANTIC_FAILURE' : null}))}));
  assert.equal(publicReject.milestone, 'CAT_P05S_BLOCKED');
  const operational = deriveP05Outcome(outcomeInput({blindOutcome: 'INCONCLUSIVE'}));
  assert.equal(operational.candidateResult.decision, null);
  assert.equal(operational.candidateResult.jobStatus, 'INCONCLUSIVE');
});

test('repair projection is deterministic, allowlisted, and removed after use', () => {
  const projections = [createRepairProjection(root), createRepairProjection(root), createRepairProjection(root)];
  try {
    const [first, ...rest] = projections;
    assert.equal(first.result.manifest.version, 1);
    assert.ok(first.result.manifest.files.length > 0);
    assert.ok(rest.every((item) => item.result.manifest.workspaceHash === first.result.manifest.workspaceHash));
    assert.ok(first.result.manifest.files.some((file) => file.role === 'candidate-source'));
    assert.ok(first.result.manifest.files.some((file) => file.role === 'public-test'));
    assert.ok(first.result.manifest.files.some((file) => file.role === 'contract'));
    assert.ok(first.result.manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256) && file.bytes > 0));
    assert.ok(first.result.sensitiveChecks.every((check) => check.hashMatch === false));
    assert.deepEqual(Object.values(first.result.leakage), Array(9).fill('PASS'));
    const git = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {cwd: first.workspacePath, encoding: 'utf8', windowsHide: true});
    assert.notEqual(git.status, 0);
    const plan = createRepairExecutionPlan(first.workspacePath, {NEBIUS_API_KEY: 'sentinel', CAT_HOLDOUT_SEED: 'sentinel', PATH: 'safe'});
    assert.deepEqual(Object.keys(plan.environment), []);
    assert.ok(plan.excludedSensitiveNames.includes('NEBIUS_API_KEY'));
    assert.ok(plan.excludedSensitiveNames.includes('CAT_HOLDOUT_SEED'));
    assert.deepEqual(plan.mounts, [{source: first.workspacePath, target: '/workspace', readOnly: true, kind: 'repair-workspace'}]);
    assert.equal(plan.dockerControl, false);
    assert.equal(plan.networkAccess, false);
    const file = first.result.manifest.files[0];
    const filePath = path.join(first.workspacePath, ...file.path.split('/'));
    const originalBytes = readFileSync(filePath);
    const changedBytes = Buffer.from(originalBytes);
    changedBytes[0] ^= 1;
    writeFileSync(filePath, changedBytes);
    const changedFileHash = createHash('sha256').update(changedBytes).digest('hex');
    const changedRows = first.result.manifest.files.map((row) => row.path === file.path ? {...row, sha256: changedFileHash} : row);
    assert.notEqual(workspaceHashForFiles(changedRows), first.result.manifest.workspaceHash);
    writeFileSync(filePath, originalBytes);
  } finally {
    for (const item of projections) item.cleanup();
  }
  assert.ok(projections.every((item) => !pathExists(item.workspacePath)));
});

function pathExists(value: string) {
  return existsSync(value);
}

test('repair request package is canonical and binds its public source context', () => {
  const paths = ['candidate/_src/index.coffee','candidate/_src/lib/node_cache.coffee','candidate/_src/test/node_cache-test.coffee','candidate/_src/test/test-expire.coffee',
    'candidate/index.js','candidate/lib/node_cache.js','candidate/test/node_cache-test.js','candidate/test/test-expire.js','candidate/package.json','candidate/Gruntfile.coffee',
    'candidate/contract-v3.json','candidate/witness.json','candidate/oracle-v2.json','public/BUILD.txt','public/existing-suite-result.json'];
  const contextFiles = paths.map((filePath, index) => { const content = 'public file ' + index; const role = filePath === `candidate/${REPAIR_MODIFIABLE_PATH}` ? 'candidate-source' :
    filePath === 'candidate/index.js' || filePath === 'candidate/lib/node_cache.js' ? 'candidate-runtime' :
      filePath === 'candidate/contract-v3.json' ? 'contract' : filePath === 'candidate/oracle-v2.json' ? 'public-oracle' : 'public-test';
    return {path: filePath, sha256: createHash('sha256').update(content).digest('hex'), role, content}; });
  const manifest = {caseId: 'node-cache-ttl-zero-001', files: contextFiles.map(({path, sha256, role}) => ({path, sha256, role})),
    workspaceHash: workspaceHashForFiles(contextFiles.map(({path, sha256, role}) => ({path, sha256, role})))};
  const input = {caseId: 'node-cache-ttl-zero-001', model: 'nvidia/test', manifestHash: createHash('sha256').update(canonical(manifest)).digest('hex'),
    workspaceHash: manifest.workspaceHash,
    publicContractHash: contextFiles.find((f) => f.path === 'candidate/contract-v3.json')!.sha256,
    publicOracleHash: contextFiles.find((f) => f.path === 'candidate/oracle-v2.json')!.sha256,
    baseSha256: contextFiles.find((f) => f.path === `candidate/${REPAIR_MODIFIABLE_PATH}`)!.sha256, contextFiles};
  const first = createRepairRequestPackage(input);
  const second = createRepairRequestPackage(input);
  assert.equal(first.bytes, second.bytes);
  assert.equal(first.sha256, second.sha256);
  assert.match(first.bytes, /public file/);
  assert.deepEqual(first.value.modifiablePaths, [REPAIR_RESPONSE_SCHEMA.properties.path.const]);
  assert.equal(first.value.version, 2);
  assert.equal(first.value.publicContextFiles.filter((file: any) => file.contentOmitted === true).length, 4);
  verifyRepairRequestContext(first.value, manifest);
  const v1 = createRepairRequestPackage({...input, version: 1});
  assert.ok(Buffer.byteLength(first.bytes) < Buffer.byteLength(v1.bytes));
  verifyRepairRequestContext(v1.value, manifest);
  assert.throws(() => verifyRepairRequestContext({...first.value, publicContextFiles: first.value.publicContextFiles.map((file: any) =>
    file.path === 'candidate/index.js' ? {...file, path: 'candidate/other.js'} : file)}, manifest), /REPAIR_REQUEST_CONTEXT_INVALID/);
  assert.throws(() => verifyRepairRequestContext({...first.value, publicContextFiles: first.value.publicContextFiles.map((file: any) =>
    file.path === 'candidate/index.js' ? {...file, contentOmitted: false} : file)}, manifest), /REPAIR_REQUEST_CONTEXT_OMISSION_INVALID/);
  assert.throws(() => verifyRepairRequestContext({...first.value, publicContextFiles: first.value.publicContextFiles.slice(1)}, manifest), /REPAIR_REQUEST_CONTEXT_INVALID/);
  assert.throws(() => verifyRepairRequestContext({...first.value, publicContextFiles: first.value.publicContextFiles.map((file: any) =>
    file.path === 'candidate/package.json' ? {...file, sha256: hash('b')} : file)}, manifest), /REPAIR_REQUEST_CONTEXT_INVALID/);
  assert.throws(() => verifyRepairRequestContext({...v1.value, publicContextFiles: first.value.publicContextFiles}, manifest), /REPAIR_REQUEST_CONTEXT_INVALID/);
  assert.throws(() => createRepairRequestPackage({...input, contextFiles: input.contextFiles.map((file, index) => index === 0 ? {...file, content: 'changed'} : file)}), /REPAIR_REQUEST_CONTEXT_INVALID/);
});

test('model response accepts only the one exact source replacement', () => {
  const base = hash('e');
  const raw = JSON.stringify({path: REPAIR_MODIFIABLE_PATH, baseSha256: base, replacementText: 'ttl = 0'});
  const parsed = validateRepairProposal(raw, base);
  assert.equal(parsed.proposal.path, REPAIR_MODIFIABLE_PATH);
  assert.match(parsed.validatedSha256, /^[a-f0-9]{64}$/);
  for (const proposal of [
    {path: '../test.coffee', baseSha256: base, replacementText: 'x'},
    {path: 'C:/candidate.coffee', baseSha256: base, replacementText: 'x'},
    {path: 'candidate/test/node_cache-test.coffee', baseSha256: base, replacementText: 'x'},
    {path: 'src/verifier/sealed-verifier.ts', baseSha256: base, replacementText: 'x'},
    {path: REPAIR_MODIFIABLE_PATH, baseSha256: hash('a'), replacementText: 'x'},
    {path: REPAIR_MODIFIABLE_PATH, baseSha256: base, replacementText: 'x', extra: true},
  ]) assert.throws(() => validateRepairProposal(JSON.stringify(proposal), base), /REPAIR_RESPONSE_SCHEMA_INVALID/);
  assert.throws(() => validateRepairProposal('{', base), /REPAIR_RESPONSE_JSON_INVALID/);
  assert.throws(() => validateRepairProposal(JSON.stringify({path: REPAIR_MODIFIABLE_PATH, baseSha256: base, replacementText: 'x\0'}), base), /REPAIR_RESPONSE_SCHEMA_INVALID/);
});

test('proposal application changes only the bound candidate source file', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-apply-'));
  const target = path.join(root, ...REPAIR_MODIFIABLE_PATH.split('/'));
  mkdirSync(path.dirname(target), {recursive: true});
  writeFileSync(target, 'old source');
  writeFileSync(path.join(root, 'public-test.json'), 'immutable public test');
  try {
    const beforeSha256 = createHash('sha256').update('old source').digest('hex');
    const result = applyRepairProposal(root, {path: REPAIR_MODIFIABLE_PATH, baseSha256: beforeSha256, replacementText: 'new source'});
    assert.deepEqual(result.changedPaths, [REPAIR_MODIFIABLE_PATH]);
    assert.equal(readFileSync(target, 'utf8'), 'new source');
    assert.equal(existsSync(path.join(root, 'candidate', ...REPAIR_MODIFIABLE_PATH.split('/'))), false);
    assert.throws(() => applyRepairProposal(root, {path: `candidate/${REPAIR_MODIFIABLE_PATH}` as any, baseSha256: beforeSha256, replacementText: 'bad'}), /REPAIR_PATH_NOT_ALLOWED/);
    assert.equal(readFileSync(path.join(root, 'public-test.json'), 'utf8'), 'immutable public test');
    assert.throws(() => applyRepairProposal(root, {path: REPAIR_MODIFIABLE_PATH, baseSha256: beforeSha256, replacementText: 'again'}), /REPAIR_BASE_HASH_MISMATCH/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('repair provider needs the exact model and a one-use authorization before any POST', async () => {
  let calls = 0;
  let request: Record<string, unknown> | undefined;
  const raw = JSON.stringify({path: REPAIR_MODIFIABLE_PATH, baseSha256: hash('e'), replacementText: 'replacement'});
  await assert.rejects(requestRepairProposal({apiKey: 'private-test-key', model: APPROVED_REPAIR_MODEL_ID, liveModels: [{id: APPROVED_REPAIR_MODEL_ID}], requestPackage: 'canonical public package', baseSha256: hash('e'),
    options: {fetchImplementation: async (_input, init) => {
      calls++;
      request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({id: 'request-1', model: APPROVED_REPAIR_MODEL_ID, choices: [{finish_reason: 'stop', message: {content: raw}}], usage: {prompt_tokens: 1, completion_tokens: 2, total_tokens: 3}}), {status: 200});
    }}}), /INFERENCE_AUTHORIZATION_REQUIRED/);
  assert.equal(calls, 0);
  assert.equal(request, undefined);
  await assert.rejects(requestRepairProposal({apiKey: 'x', model: 'nvidia/not-live', liveModels: [], requestPackage: 'x', baseSha256: hash('e')}), /REPAIR_MODEL_NOT_CURRENTLY_DISCOVERED_NVIDIA/);
  await assert.rejects(requestRepairProposal({apiKey: 'x', model: 'nvidia/nemotron-3.5-lightning', liveModels: [{id: 'nvidia/nemotron-3.5-lightning'}], requestPackage: 'x', baseSha256: hash('e')}), /REPAIR_MODEL_NOT_CURRENTLY_DISCOVERED_NVIDIA/);
  await assert.rejects(requestRepairProposal({apiKey: 'x', model: APPROVED_REPAIR_MODEL_ID, liveModels: [{id: APPROVED_REPAIR_MODEL_ID}], requestPackage: 'x'.repeat(MAX_REPAIR_PACKAGE_BYTES + 1), baseSha256: hash('e'), options: {fetchImplementation: async () => {calls++; throw new Error('must not send');}}}), /REPAIR_REQUEST_PACKAGE_TOO_LARGE/);
  assert.equal(calls, 0);
});

test('repair inference timeout is explicit and authorization is required before transport', async () => {
  const source = readFileSync(path.join(root, 'scripts/cat-repair.ts'), 'utf8');
  assert.match(source, /const CAT_REPAIR_INFERENCE_TIMEOUT_MS = 180_000;/);
  assert.match(source, /options: \{baseUrl, timeoutMs: CAT_REPAIR_INFERENCE_TIMEOUT_MS, retryDns: false,/);
  assert.match(source, /authorizationFile: process\.env\.CAT_INFERENCE_AUTHORIZATION_FILE/);
  assert.match(source, /operationId: runId/);
  assert.match(source, /requestTimeoutMs: CAT_REPAIR_INFERENCE_TIMEOUT_MS/);
  assert.match(source, /writePrivate\('repair-inference-timeout', canonical\(\{runId, stage, requestTimeoutMs: CAT_REPAIR_INFERENCE_TIMEOUT_MS\}\)\)/);

  let attempts = 0;
  await assert.rejects(requestRepairProposal({apiKey: 'test-key', model: APPROVED_REPAIR_MODEL_ID, liveModels: [{id: APPROVED_REPAIR_MODEL_ID}],
    requestPackage: 'synthetic package', baseSha256: hash('e'), options: {timeoutMs: 180_000, fetchImplementation: async () => {
      attempts++;
      throw new TypeError('fetch failed', {cause: Object.assign(new Error('synthetic timeout'), {code: 'ETIMEDOUT', syscall: 'connect'})});
    }}}), /INFERENCE_AUTHORIZATION_REQUIRED/);
  assert.equal(attempts, 0);
});

test('repair inference rejects before transport when one-use authorization is absent', async () => {
  let attempts = 0;
  await assert.rejects(requestRepairProposal({apiKey: 'test-key', model: APPROVED_REPAIR_MODEL_ID, liveModels: [{id: APPROVED_REPAIR_MODEL_ID}],
    requestPackage: 'synthetic package', baseSha256: hash('e'), options: {retryDns: false, fetchImplementation: async () => {
      attempts++;
      throw new TypeError('fetch failed', {cause: Object.assign(new Error('synthetic DNS failure'), {code: 'EAI_AGAIN', syscall: 'getaddrinfo'})});
    }}}), /INFERENCE_AUTHORIZATION_REQUIRED/);
  assert.equal(attempts, 0);
});

test('repair inference refuses an unauthenticated alternate call site before fetch', async () => {
  let attempts = 0;
  await assert.rejects(requestRepairProposal({apiKey: 'test-key', model: APPROVED_REPAIR_MODEL_ID, liveModels: [{id: APPROVED_REPAIR_MODEL_ID}],
    requestPackage: 'synthetic package', baseSha256: hash('e'), options: {fetchImplementation: async () => {
      attempts++;
      throw new TypeError('fetch failed', {cause: Object.assign(new Error('synthetic DNS failure'), {code: 'EAI_AGAIN', syscall: 'getaddrinfo'})});
    }}}), /INFERENCE_AUTHORIZATION_REQUIRED/);
  assert.equal(attempts, 0);
});

test('cat-repair hash-binds only sanitized diagnostics while preserving terminal code authority', () => {
  const source = readFileSync(path.join(root, 'scripts/cat-repair.ts'), 'utf8');
  assert.match(source, /const diagnostic = getTokenFactoryFailureDiagnostic\(error\);/);
  assert.match(source, /writePrivate\('terminal-provider-diagnostic', canonical\(\{runId, stage, diagnostic\}\)\)/);
  assert.match(source, /const operationalFailure = \{stage, code\};/);
  assert.match(source, /writePrivate\('terminal-failure', canonical\(\{runId, stage, code, implementationSha: binding\.implementationSha, decision\}\)\)/);
  for (const field of ['CAT_NETWORK_ERROR_NAME', 'CAT_NETWORK_CAUSE_NAME', 'CAT_NETWORK_CAUSE_CODE', 'CAT_NETWORK_CAUSE_ERRNO',
    'CAT_NETWORK_CAUSE_SYSCALL', 'CAT_NETWORK_CAUSE_HOSTNAME', 'CAT_NETWORK_CAUSE_ADDRESS', 'CAT_NETWORK_CAUSE_PORT']) {
    assert.ok(source.includes(field));
  }
});

test('repair provider rejects non-NVIDIA namespace IDs despite NVIDIA owner or name metadata', async () => {
  for (const model of [
    {id: 'vendor/Nemotron-3-Super-120B-A12B'},
    {id: 'thirdparty/foo', owned_by: 'nvidia'},
    {id: 'thirdparty/foo', name: 'NVIDIA Nemotron'},
  ]) {
    await assert.rejects(requestRepairProposal({apiKey: 'x', model: model.id, liveModels: [model], requestPackage: 'x', baseSha256: hash('e')}),
      /REPAIR_MODEL_NOT_CURRENTLY_DISCOVERED_NVIDIA/);
  }
});

function terminalReceiptFixture(root: string, runId: string, source: ImplementationSource, overrides: Record<string, unknown> = {}) {
  const binding = assertP05ImplementationBinding(source, 'hackathon/nebius-nvidia-cat-r5-20261006');
  const store = createV5EvidenceStore(root, runId);
  const reasonCodes = ['DOCKER_BACKEND_UNAVAILABLE'];
  const operationalFailure = {stage: 'backend', code: reasonCodes[0]};
  const candidateHash = hash('b');
  const candidateResult = {jobStatus: 'INCONCLUSIVE', decision: null, reasonCodes};
  const terminalFailure = store.writePrivate('terminal-failure', JSON.stringify({runId, stage: 'backend', code: reasonCodes[0], implementationSha: binding.implementationSha, decision: null}));
  const privateReceipt = store.createPrivateReceipt({...binding, runId, candidateHash, decision: null, jobStatus: 'INCONCLUSIVE',
    candidateResult, experimentIntegrity: 'INCOMPLETE', milestone: 'CAT_P05S_BLOCKED', operationalFailure, reasonCodes,
    stage: 'backend', objects: [terminalFailure], ...overrides});
  const terminalSummary = store.writePublic('terminal-summary', JSON.stringify({runId, status: 'CAT_P05S_BLOCKED', candidateHash,
    jobStatus: 'INCONCLUSIVE', decision: null, candidateResult, experimentIntegrity: 'INCOMPLETE', milestone: 'CAT_P05S_BLOCKED',
    operationalFailure, reasonCodes}));
  const publicReceipt = store.createPublicReceipt({...binding, runId, candidateHash, decision: null, jobStatus: 'INCONCLUSIVE',
    candidateResult, experimentIntegrity: 'INCOMPLETE', milestone: 'CAT_P05S_BLOCKED', operationalFailure, reasonCodes,
    status: 'CAT_P05S_BLOCKED', publicObjects: [terminalSummary], ...overrides}, privateReceipt.object);
  return {store, privateValue: terminalFailure, publicReceipt, source};
}

test('v5 receipt binds git implementation files and detects object or implementation mutation', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-receipt-'));
  const runId = '1aa11111-1111-4111-8111-111111111111';
  const source = fakeImplementationSource();
  const fixture = terminalReceiptFixture(root, runId, source);
  try {
    assert.equal(verifyV5Receipt(root, runId, fixture.publicReceipt.object.sha256, source).verified, true);
    const privatePath = path.join(fixture.store.root, ...fixture.privateValue.id.split('/'));
    chmodSync(privatePath, 0o600);
    writeFileSync(privatePath, 'tampered');
    assert.throws(() => verifyV5Receipt(root, runId, fixture.publicReceipt.object.sha256, source), /RECEIPT_OBJECT_HASH_MISMATCH/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('v5 receipt rejects contradictory job decisions, incomplete evidence, and forged implementation file hashes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-receipt-invalid-'));
  const source = fakeImplementationSource();
  try {
    const contradictory = terminalReceiptFixture(root, '2bb11111-1111-4111-8111-111111111111', source,
      {decision: 'REJECTED', candidateResult: {jobStatus: 'INCONCLUSIVE', decision: 'REJECTED', reasonCodes: ['DOCKER_BACKEND_UNAVAILABLE']}});
    assert.throws(() => verifyV5Receipt(root, '2bb11111-1111-4111-8111-111111111111', contradictory.publicReceipt.object.sha256, source), /RECEIPT_OPERATIONAL_FAILURE_INVALID/);
    const forgedSource = fakeImplementationSource();
    const binding = assertP05ImplementationBinding(forgedSource, 'hackathon/nebius-nvidia-cat-r5-20261006');
    binding.implementationFiles[0].sha256 = hash('9');
    const forged = terminalReceiptFixture(root, '3cc11111-1111-4111-8111-111111111111', forgedSource,
      {implementationFiles: binding.implementationFiles});
    assert.throws(() => verifyV5Receipt(root, '3cc11111-1111-4111-8111-111111111111', forged.publicReceipt.object.sha256, forgedSource), /RECEIPT_IMPLEMENTATION_BINDING_MISMATCH/);
    const empty = createV5EvidenceStore(root, '4dd11111-1111-4111-8111-111111111111');
    const validBinding = assertP05ImplementationBinding(source, 'hackathon/nebius-nvidia-cat-r5-20261006');
    assert.throws(() => empty.createPrivateReceipt({...validBinding, runId: '4dd11111-1111-4111-8111-111111111111', candidateHash: hash('b'), decision: null, objects: []}), /RECEIPT_EVIDENCE_MISSING/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

function completeReceiptFixture(root: string, runId: string, source: ImplementationSource, decision: 'ACCEPTED' | 'REJECTED' = 'ACCEPTED', blindResult: 'PASS' | 'FAIL' = 'PASS', options: {omitRole?: string; blindBackend?: string; holdoutBeforeFreeze?: boolean} = {}) {
  const binding = assertP05ImplementationBinding(source, 'hackathon/nebius-nvidia-cat-r5-20261006');
  const store = createV5EvidenceStore(root, runId);
  const backend: RepairBackend = 'LOCAL_DOCKER_FALLBACK';
  const fileContent = Buffer.from('candidate source bytes');
  const frozenFile = store.writePrivate('frozen-candidate-file', fileContent);
  const frozenRows = [{path: '_src/lib/node_cache.coffee', sha256: frozenFile.sha256, objectId: frozenFile.id, bytes: fileContent.length}];
  const candidateHash = createHash('sha256').update(JSON.stringify(frozenRows.map(({path: filePath, sha256: digest}) => ({path: filePath, sha256: digest})))).digest('hex');
  const request = store.writePrivate('model-request-package', '{"request":true}');
  const response = store.writePrivate('model-response', '{"response":true}');
  const patchSha256 = hash('8');
  const publicGateEvidence = ['build', 'existing-suite', 'public-contract', 'public-oracle-v2'].map((gate) => ({gate, candidateHash,
    backend, command: ['fixed-command'], exitCode: 0, outputSha256: hash('1'), runtimeSha256: hash('2'), semantic: 'PASS'}));
  const gateRef = store.writePrivate('public-gate-evidence', JSON.stringify(publicGateEvidence));
  const frozenAt = '2026-01-01T00:00:00.000Z';
  const seedAt = '2026-01-01T00:00:01.000Z';
  const holdoutAt = options.holdoutBeforeFreeze ? '2025-12-31T23:59:59.000Z' : '2026-01-01T00:00:02.000Z';
  const holdoutBytes = Buffer.from('{"challenges":[{}]}');
  const holdout = store.writePrivate('sealed-holdout', holdoutBytes);
  const blindEvidence = {backend: options.blindBackend ?? backend, candidateHash, holdoutSeal: holdout.sha256, candidateFrozenAt: frozenAt,
    seedCreatedAt: seedAt, holdoutCreatedAt: holdoutAt,
    blindResults: [{semantic: blindResult, outputSha256: hash('3'), runtimeSha256: hash('2'), command: ['observe'], exitCode: 0, start: 1, finish: 2}]};
  const blindRef = store.writePrivate('blind-gate-evidence', JSON.stringify(blindEvidence));
  const frozenManifest = {candidateHash, candidateFrozenAt: frozenAt, implementationSha: binding.implementationSha,
    implementationTreeSha: binding.implementationTreeSha, implementationFiles: binding.implementationFiles, executionBackend: backend, rows: frozenRows};
  const frozenRef = store.writePrivate('frozen-candidate-manifest', JSON.stringify(frozenManifest));
  const dockerEvidence = store.writePrivate('docker-lifecycle-evidence', JSON.stringify({build: [{}], existingSuite: [{}], publicWitness: [{}], blind: [{}]}));
  const sandboxStatus = 'SANDBOX_CLIENT_UNAVAILABLE';
  const backendAttestation = {backend, image: 'sha256:' + '4'.repeat(64), network: 'none', dockerVersion: 'Docker version test', dockerHostSha256: hash('5'),
    readOnlyRoot: true, nonRoot: true, capDrop: 'ALL', sandboxStatus, sandboxOperationId: null, sandboxEvidenceSha256: null, sandboxReason: 'sandbox unavailable'};
  const privateRoles = [request, response, gateRef, frozenFile, holdout, blindRef, frozenRef, dockerEvidence,
    store.writePrivate('projection-manifest', '{}'), store.writePrivate('backend-attestation', JSON.stringify(backendAttestation)),
    store.writePrivate('provider-metadata', '{}')].filter((item) => item.role !== options.omitRole);
  const publicOutcomes = publicGateEvidence.map(({gate, semantic, exitCode}) => ({gate, result: semantic, exitCode}));
  const reasonCodes = decision === 'ACCEPTED' ? ['ALL_GATES_PASS'] : ['SEALED_SEMANTIC_FAILURE'];
  const decisionResult = {jobStatus: 'COMPLETED', decision, reasonCodes};
  const milestone = 'CAT_P05S_SPONSOR_PASS_SANDBOX_BLOCKED';
  const requestPackageSha256 = request.sha256, responseSha256 = response.sha256, validatedResponseSha256 = hash('6');
  const publicRun = {runId, status: milestone, milestone, candidateResult: decisionResult, experimentIntegrity: 'PASS',
    implementationSha: binding.implementationSha, implementationTreeSha: binding.implementationTreeSha, implementationFiles: binding.implementationFiles,
    backend, candidateHash, sandboxStatus, sandboxOperationId: null, sandboxEvidenceSha256: null, publicOutcomes,
    candidateFrozenAt: frozenAt, frozenCandidateHash: candidateHash, seedCreatedAt: seedAt, holdoutCreatedAt: holdoutAt,
    holdoutSeal: holdout.sha256, blindResult, decision, reasonCodes, requestPackageSha256, responseSha256, validatedResponseSha256, patchSha256};
  const publicObjects = [store.writePublic('projection-summary', '{}'), store.writePublic('live-model-catalog', '{}'),
    store.writePublic('public-run-summary', JSON.stringify(publicRun))];
  const publicReceipt = store.createPublicReceipt({...binding, runId, candidateHash, candidateResult: decisionResult, experimentIntegrity: 'PASS',
    milestone, jobStatus: 'COMPLETED', decision, reasonCodes, status: milestone, executionBackend: backend, sandboxStatus, sandboxOperationId: null,
    sandboxEvidenceSha256: null, requestPackageSha256, responseSha256, validatedResponseSha256, patchSha256, candidateFrozenAt: frozenAt,
    frozenCandidateHash: candidateHash, seedCreatedAt: seedAt, holdoutCreatedAt: holdoutAt, holdoutSeal: holdout.sha256, blindResult,
    publicOutcomes, publicObjects}, store.createPrivateReceipt({...binding, runId, candidateHash, candidateResult: decisionResult,
      experimentIntegrity: 'PASS', milestone, jobStatus: 'COMPLETED', decision, reasonCodes, state: 'COMPLETED', provider: {},
      patchApplication: {patchSha256}, modelRequestObjectId: request.id, modelResponseObjectId: response.id,
      requestPackageSha256, responseSha256, validatedResponseSha256, publicEvidence: publicGateEvidence, publicGateEvidenceSha256: gateRef.sha256,
      frozenCandidateManifestSha256: frozenRef.sha256, candidateFrozenAt: frozenAt, frozenCandidateHash: candidateHash,
      seedCreatedAt: seedAt, holdoutCreatedAt: holdoutAt, holdoutSeal: holdout.sha256, blindResult, holdoutObjectId: holdout.id,
      executionBackend: backend, sandboxStatus, sandboxOperationId: null, sandboxEvidenceSha256: null, sandboxBlockerReason: 'sandbox unavailable',
      dockerEvidenceSha256: dockerEvidence.sha256, dependencyTreeSha256: hash('7'), objects: privateRoles}).object);
  return {publicReceipt, source};
}

function completeTypedReceiptFixture(root: string, runId: string, source: ImplementationSource, options: {
  blindFail?: boolean; blindSummary?: 'PASS' | 'FAIL'; blindBeforeSeal?: boolean; dockerBeforeSealObservationAfter?: boolean;
  forgePostSealBlindTimestamp?: boolean; missingBlindRow?: boolean; duplicateBlindRow?: boolean;
  cleanupFailure?: boolean; sandboxLabel?: boolean; modelConflict?: boolean; requestIdConflict?: boolean; requestHashConflict?: boolean;
  reasonMislabel?: boolean; operationalAsReject?: boolean; oracleFailure?: boolean; providerEnvelopeModelConflict?: boolean; networkAttempts?: number;
  clock?: {publicStartOffsetMs?: number; publicFinishOffsetMs?: number; publicRowStartDeltaMs?: number; publicOutputShaMismatch?: boolean;
    publicObservationConflict?: boolean; publicRuntimeShaMismatch?: boolean; publicExecutionIdMismatch?: boolean; dockerExecutionIdMismatch?: boolean;
    invalidHostStart?: boolean; hostFinishBeforeStart?: boolean; invalidObservationStart?: boolean; blindStartOffsetMs?: number;
    blindFinishOffsetMs?: number; blindHostStartBeforeSealMs?: number; blindLifecycleBeforeSeal?: boolean};
} = {}) {
  const binding = assertP05ImplementationBinding(source, 'hackathon/nebius-nvidia-cat-r5-20261006');
  const store = createV5EvidenceStore(root, runId);
  const backend: RepairBackend = 'LOCAL_DOCKER_FALLBACK';
  const projection = createRepairProjection(path.resolve(import.meta.dirname, '..'));
  const putPrivate = (role: string, value: Buffer | string) => store.writePrivate(role, value);
  const putPublic = (role: string, value: Buffer | string) => store.writePublic(role, value);
  const privateRefs: any[] = [];
  const addPrivate = (role: string, value: Buffer | string) => { const ref = putPrivate(role, value); privateRefs.push(ref); return ref; };
  const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
  const frozenAt = at(5), seedAt = at(6), sealedAt = at(7), blindStartedAt = at(7), blindEndedAt = at(11);
  const hashBytes = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
  let blindPhase = false;
  try {
    const manifest = structuredClone(projection.result.manifest) as any;
    let contextFiles = manifest.files.map((file: any) => ({...file,
      content: readFileSync(path.join(projection.workspacePath, ...file.path.split('/')), 'utf8')}));
    if (options.oracleFailure) {
      const oracleFile = contextFiles.find((file: any) => file.path === 'candidate/oracle-v2.json')!;
      const oracle = JSON.parse(oracleFile.content); oracle.expected = {...oracle.expected, found: false};
      oracleFile.content = canonical(oracle); oracleFile.sha256 = hashBytes(oracleFile.content);
    }
    const contextHash = workspaceHashForFiles(contextFiles.map(({path: filePath, sha256, role}: any) => ({path: filePath, sha256, role})));
    manifest.files = contextFiles.map(({path: filePath, sha256, role}: any) => ({path: filePath, sha256, role}));
    manifest.workspaceHash = contextHash;
    const base = contextFiles.find((file: any) => file.path === `candidate/${REPAIR_MODIFIABLE_PATH}`)!;
    const contractFile = contextFiles.find((file: any) => file.path === 'candidate/contract-v3.json')!;
    const oracleFile = contextFiles.find((file: any) => file.path === 'candidate/oracle-v2.json')!;
    const requestPackage = createRepairRequestPackage({caseId: 'node-cache-ttl-zero-001', model: 'nvidia/test-model',
      manifestHash: hashBytes(canonical(manifest)), workspaceHash: contextHash, publicContractHash: contractFile.sha256,
      publicOracleHash: oracleFile.sha256, baseSha256: base.sha256, contextFiles});
    const proposal = {path: REPAIR_MODIFIABLE_PATH, baseSha256: base.sha256, replacementText: 'fixture candidate source'};
    const responseText = JSON.stringify(proposal);
    const validated = validateRepairProposal(responseText, base.sha256);
    const requestRef = addPrivate('model-request-package', requestPackage.bytes);
    const envelopeBytes = Buffer.from(JSON.stringify({id: 'payload-request-id', model: options.providerEnvelopeModelConflict ? 'nvidia/other-model' : 'nvidia/test-model',
      choices: [{finish_reason: 'stop', message: {content: responseText}}], usage: {prompt_tokens: 1, completion_tokens: 2, total_tokens: 3}}));
    const responseRef = addPrivate('model-response', envelopeBytes);
    addPrivate('model-response-content', responseText);
    const validatedRef = addPrivate('validated-model-response', canonical(validated.proposal));
    const fileSha256 = hashBytes(proposal.replacementText);
    const patchSha256 = hashBytes(canonical({path: REPAIR_MODIFIABLE_PATH, baseFileSha256: base.sha256, resultFileSha256: fileSha256}));
    const providerMeta = {provider: 'Nebius', baseEndpoint: 'https://api.tokenfactory.nebius.com/v1/',
      requestEndpoint: 'https://api.tokenfactory.nebius.com/v1/chat/completions', requestedModel: 'nvidia/test-model', returnedModel: 'nvidia/test-model',
      requestId: 'request-1', operationId: 'operation-1', requestPackageSha256: requestRef.sha256, responseSha256: responseRef.sha256,
      validatedResponseSha256: validatedRef.sha256, finishReason: 'stop', usage: {prompt: 1, completion: 2, total: 3}, latencyMs: 10,
      cost: 'UNKNOWN', networkAttempts: options.networkAttempts ?? 1, recoveredNetworkCause: 'NONE'};
    addPrivate('provider-http-evidence', canonical({version: 1, endpoint: providerMeta.requestEndpoint, status: 200,
      requestHeaders: {accept: 'application/json', 'content-type': 'application/json'},
      responseHeaders: {contentType: 'application/json', xRequestId: 'request-1', requestId: null, operationId: 'operation-1'},
      networkAttempts: options.networkAttempts ?? 1, recoveredNetworkCause: 'NONE'}));
    addPrivate('provider-metadata', canonical(providerMeta));
    const modelCatalog = putPublic('live-model-catalog', canonical({models: [{id: 'nvidia/test-model'}], nvidia: [{id: 'nvidia/test-model'}], selected: 'nvidia/test-model'}));
    const runtimeSha256 = hashBytes('runtime');
    let executionIndex = 0;
    const executions: any[] = [];
    const docker = (operation: 'build' | 'suite' | 'observe', result: Record<string, any>) => {
      executionIndex++;
      const executionEvidenceId = `1aa11111-1111-4111-8111-${String(executionIndex).padStart(12, '0')}`;
      const containerId = String(executionIndex).repeat(64).slice(0, 64);
      const preSealBlindExecution = blindPhase && executionIndex === 4 && options.blindBeforeSeal;
      const dockerBeforeSeal = blindPhase && executionIndex === 4 && options.dockerBeforeSealObservationAfter;
      const blindHostStartBeforeSeal = blindPhase && operation === 'observe' && executionIndex === 4 && options.clock?.blindHostStartBeforeSealMs;
      const startedAt = preSealBlindExecution ? at(3) : dockerBeforeSeal ? new Date(Date.parse(at(7)) - 100).toISOString()
        : blindHostStartBeforeSeal ? new Date(Date.parse(at(7)) - blindHostStartBeforeSeal).toISOString() :
          !blindPhase && operation === 'observe' && options.clock?.hostFinishBeforeStart ? at(4) : at(blindPhase ? executionIndex + 4 : executionIndex);
      const finishedAt = preSealBlindExecution ? at(4) : dockerBeforeSeal ? at(8) :
        !blindPhase && operation === 'observe' && options.clock?.hostFinishBeforeStart ? at(3) : at((blindPhase ? executionIndex + 4 : executionIndex) + 1);
      const hostStartedAt = !blindPhase && operation === 'observe' && options.clock?.invalidHostStart ? 'invalid-host-time' : startedAt;
      const createArgs = ['docker', 'create', '--pull=never', '-i', '--name', `cat-p05s-${executionEvidenceId}`, '--network', 'none', '--read-only',
        '--pids-limit', '64', '--memory', '256m', '--cpus', '1', '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--workdir', '/candidate', '--env', 'NODE_PATH=/deps/node_modules',
        '--mount', `type=bind,source=C:\\candidate,target=/candidate${operation === 'build' ? '' : ',readonly'}`,
        '--mount', 'type=bind,source=C:\\deps,target=/deps/node_modules,readonly', '--mount', 'type=bind,source=C:\\runner.cjs,target=/runner.cjs,readonly',
        'sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32', 'node', '/runner.cjs', operation];
      const observationStartOffset = blindPhase ? options.clock?.blindStartOffsetMs ?? 100 : options.clock?.publicStartOffsetMs ?? 100;
      const observationFinishOffset = blindPhase ? options.clock?.blindFinishOffsetMs ?? -100 : options.clock?.publicFinishOffsetMs ?? -100;
      const observationStartedAt = operation === 'observe' ? Date.parse(hostStartedAt) + observationStartOffset : undefined;
      const observationFinishedAt = operation === 'observe' ? Date.parse(finishedAt) + observationFinishOffset : undefined;
      const executionResult = operation === 'observe' ? {...result,
        observationStartedAt: options.clock?.invalidObservationStart && !blindPhase ? Number.NaN : observationStartedAt,
        observationFinishedAt} : result;
      const startStdout = JSON.stringify(executionResult) + '\n';
      const commands = [
        {name: 'create', args: createArgs, exitCode: 0, outputSha256: hash('a')},
        {name: 'start', args: ['docker', 'start', '-a', '-i', containerId], exitCode: 0, outputSha256: hashBytes(startStdout + '\0')},
        {name: 'inspect', args: ['docker', 'inspect', '--format={{json .State}}', containerId], exitCode: 0, outputSha256: hash('b')},
        {name: 'remove', args: ['docker', 'rm', '-f', containerId], exitCode: 0, outputSha256: hash('c')},
        {name: 'verify-removed', args: ['docker', 'container', 'ls', '-a', '--no-trunc', '--filter', `id=${containerId}`, '--format', '{{.ID}}'], exitCode: 0, outputSha256: hash('d')},
      ];
      const item = {version: 1, executionEvidenceId: options.clock?.dockerExecutionIdMismatch && operation === 'observe'
          ? '9aa11111-1111-4111-8111-999999999999' : executionEvidenceId,
        backend, operation, startedAt: hostStartedAt, finishedAt, containerId,
        createInvoked: true, createExitCode: 0, startAttachInvoked: true, dockerClientExitCode: 0, inspectPerformed: true, inspectExitCode: 0,
        terminalState: {status: 'exited', running: false, oomKilled: false, dead: false, exitCode: 0},
        policy: {network: 'none', readOnlyRoot: true, nonRoot: true, capDropAll: true, noNewPrivileges: true, pidsLimit: 64, memoryLimit: '256m', cpuLimit: 1},
        cleanup: {attempted: true, removeExitCode: 0, removedContainerId: containerId, containerRemovalVerified: true, verifyExitCode: 0, cleanupResult: options.cleanupFailure ? 'FAIL' : 'PASS'},
        command: [`node /runner.cjs ${operation}`], startStdout, startStderr: '', commands, result: executionResult};
      executions.push(item); return item;
    };
    const publicOperational = !!options.operationalAsReject;
    const publicFailure = publicOperational || !!options.oracleFailure;
    const buildExec = docker('build', {operation: 'build', exitCode: 0, operational: publicOperational, outputSha256: hash('1'), runtimeSha256});
    const suiteExec = publicOperational ? null : docker('suite', {operation: 'suite', exitCode: 0, operational: false, outputSha256: hash('2'), runtimeSha256});
    const witness = JSON.parse(contextFiles.find((file: any) => file.path === 'candidate/witness.json')!.content);
    const publicObservation = witness.expectedObservation;
    const publicExec = publicOperational ? null : docker('observe', {operation: 'observe', exitCode: 0, operational: false, outputSha256: hash('3'), runtimeSha256, observation: publicObservation});
    const obsTimes = publicExec ? {startedAt: publicExec.result.observationStartedAt, finishedAt: publicExec.result.observationFinishedAt} : null;
    const skipped = (gate: string) => ({gate, candidateHash: '', backend, command: ['not-run', gate], exitCode: 0, outputSha256: hashBytes(gate), runtimeSha256,
      semantic: 'NOT_RUN', failureKind: 'SKIPPED', reasonCode: null, executionEvidenceId: null});
    const gates: any[] = [{gate: 'build', candidateHash: '', backend, command: buildExec.command, exitCode: 0,
      outputSha256: buildExec.result.outputSha256, runtimeSha256, semantic: publicOperational ? 'ERROR' : 'PASS',
      failureKind: publicOperational ? 'OPERATIONAL' : 'NONE', reasonCode: publicOperational ? 'PUBLIC_BUILD_OPERATIONAL_FAILURE' : null,
      executionEvidenceId: buildExec.executionEvidenceId}];
    if (publicOperational) gates.push(...['existing-suite', 'public-contract', 'public-oracle-v2'].map(skipped));
    else {
      gates.push({gate: 'existing-suite', candidateHash: '', backend, command: suiteExec!.command, exitCode: 0,
        outputSha256: suiteExec!.result.outputSha256, runtimeSha256, semantic: 'PASS', failureKind: 'NONE', reasonCode: null,
        executionEvidenceId: suiteExec!.executionEvidenceId});
      gates.push(...['public-contract', 'public-oracle-v2'].map((gate) => {
        const observation = options.clock?.publicObservationConflict ? {...publicObservation, found: false} : publicObservation;
        const observationStartedAt = obsTimes!.startedAt + (options.clock?.publicRowStartDeltaMs ?? 0);
        const outputSha256 = hashBytes(canonical({observation: publicObservation, startedAt: observationStartedAt, finishedAt: obsTimes!.finishedAt}));
        return {gate, candidateHash: '', backend, command: publicExec!.command, exitCode: 0,
        outputSha256: options.clock?.publicOutputShaMismatch ? hashBytes('mismatched-output') : outputSha256,
        runtimeSha256: options.clock?.publicRuntimeShaMismatch ? hashBytes('mismatched-runtime') : runtimeSha256,
        semantic: gate === 'public-oracle-v2' && options.oracleFailure ? 'FAIL' : 'PASS',
        failureKind: gate === 'public-oracle-v2' && options.oracleFailure ? 'SEMANTIC' : 'NONE',
        reasonCode: gate === 'public-oracle-v2' && options.oracleFailure ? 'PUBLIC_ORACLE_V2_FAILURE' : null,
        executionEvidenceId: options.clock?.publicExecutionIdMismatch ? '9aa11111-1111-4111-8111-999999999999' : publicExec!.executionEvidenceId,
        observation, observationStartedAt, observationFinishedAt: obsTimes!.finishedAt};
      }));
    }
    const candidateFile = publicFailure ? null : addPrivate('frozen-candidate-file', Buffer.from(proposal.replacementText));
    const candidateRows = [{path: REPAIR_MODIFIABLE_PATH, sha256: fileSha256, ...(candidateFile ? {objectId: candidateFile.id} : {}), bytes: Buffer.byteLength(proposal.replacementText)}];
    const candidateHash = hashBytes(canonical(candidateRows.map(({path: filePath, sha256}) => ({path: filePath, sha256}))));
    for (const gate of gates) gate.candidateHash = candidateHash;
    let holdoutRef: any = null, frozenRef: any = null;
    let challenges: any[] = [];
    const blindRows: any[] = [];
    if (!publicFailure) {
      const holdoutChallengeBodies = ['value-1', 'value-2'].map((value, index) => ({key: `key-${index}`, value,
        initialTtlSeconds: 20, updatedTtlSeconds: 30}));
      challenges = holdoutChallengeBodies.map((body) => ({...body, challengeId: hashBytes(canonical(body))}));
      const holdout = {runId, generatorVersion: 'positive-expiry-v1', challenges};
      holdoutRef = addPrivate('sealed-holdout', canonical(holdout));
      blindPhase = true;
      for (const [index, challenge] of challenges.entries()) {
        if (options.missingBlindRow && index === challenges.length - 1) continue;
        const executionTime = at(executionIndex + 5);
        const startedAt = executionTime;
        const endedAt = at(executionIndex + 6);
        const observation = {ttlReturned: true, found: true, value: options.blindFail && index === 1 ? 'wrong' : challenge.value,
          expiresAt: Date.parse(endedAt) + 5000};
        const exec = docker('observe', {operation: 'observe', exitCode: 0, operational: false, outputSha256: hash(index ? '5' : '4'), runtimeSha256, observation});
        const rowStartedAt = options.forgePostSealBlindTimestamp ? at(8) : new Date(exec.result.observationStartedAt).toISOString();
        const rowEndedAt = options.forgePostSealBlindTimestamp ? at(9) : new Date(exec.result.observationFinishedAt).toISOString();
        blindRows.push({runId, challengeId: options.duplicateBlindRow && index === 1 ? challenges[0].challengeId : challenge.challengeId,
          candidateHash, holdoutSeal: holdoutRef.sha256, backend, executionEvidenceId: exec.executionEvidenceId, startedAt: rowStartedAt, endedAt: rowEndedAt,
          observation, observationSha256: hashBytes(canonical(observation)), runtimeSha256, command: exec.command, exitCode: 0,
          operationalResult: 'EXECUTION_PASS', semanticResult: observation.value === challenge.value ? 'SEMANTIC_PASS' : 'SEMANTIC_FAIL'});
      }
    }
    const blindPass = blindRows.length === challenges.length && blindRows.every((row) => row.semanticResult === 'SEMANTIC_PASS');
    const actualBlindResult = publicFailure ? 'NOT_RUN' : blindPass ? 'PASS' : 'FAIL';
    const declaredBlindResult = options.blindSummary ?? actualBlindResult;
    if (!publicFailure) {
      addPrivate('blind-gate-evidence', canonical({runId, challengeCount: challenges.length, backend, candidateHash,
        holdoutSeal: holdoutRef.sha256, candidateFrozenAt: frozenAt, seedCreatedAt: seedAt, holdoutCreatedAt: sealedAt, blindResults: blindRows}));
      const frozenManifest = {candidateHash, candidateFrozenAt: frozenAt, implementationSha: binding.implementationSha,
        implementationTreeSha: binding.implementationTreeSha, implementationFiles: binding.implementationFiles,
        executionBackend: backend, rows: candidateRows};
      frozenRef = addPrivate('frozen-candidate-manifest', canonical(frozenManifest));
    }
    const gateRef = addPrivate('public-gate-evidence', canonical(gates));
    const dockerRef = addPrivate('docker-lifecycle-evidence', canonical({version: 1, backend, executions}));
    const lifecycleEvents = (publicFailure
      ? [['MODEL_RESULT_RECEIVED', at(0)], ['PUBLIC_EVALUATION_COMPLETED', at(4)]]
      : [['MODEL_RESULT_RECEIVED', at(0)], ['PUBLIC_EVALUATION_COMPLETED', at(4)], ['CANDIDATE_FROZEN', frozenAt],
        ['HOLDOUT_CREATED', seedAt], ['HOLDOUT_SEALED', sealedAt],
        ['BLIND_EXECUTION_STARTED', options.clock?.blindLifecycleBeforeSeal ? at(6) : blindStartedAt], ['BLIND_EXECUTION_COMPLETED', blindEndedAt]])
      .map(([event, timestamp], sequence) => ({sequence, event, at: timestamp}));
    const lifecycleRef = addPrivate('lifecycle-events', canonical(lifecycleEvents));
    const probe = {version: 1, provider: 'Nebius', status: 'SANDBOX_CAPABILITY_UNAVAILABLE', auth: 'CONFIGURED', project: 'CONFIGURED',
      operationId: null, evidenceSha256: hashBytes('sandbox probe'), reason: 'CANDIDATE_EGRESS_ISOLATION_UNATTESTED'};
    const attestation = {backend, image: 'sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32',
      network: 'none', dockerVersion: 'Docker version test', dockerHostSha256: hashBytes('docker host'), readOnlyRoot: true, nonRoot: true, capDrop: 'ALL',
      pidsLimit: 64, memoryLimit: '256m', cpuLimit: 1, sandboxStatus: probe.status, sandboxAuth: probe.auth, sandboxProject: probe.project,
      sandboxOperationId: null, sandboxEvidenceSha256: probe.evidenceSha256, sandboxReason: probe.reason, sandboxProbe: probe};
    addPrivate('backend-attestation', canonical(attestation));
    addPrivate('projection-manifest', canonical(manifest));
    const candidateResult = publicOperational ? {jobStatus: 'INCONCLUSIVE', decision: null, reasonCodes: ['PUBLIC_BUILD_OPERATIONAL_FAILURE']}
      : options.oracleFailure ? {jobStatus: 'COMPLETED', decision: 'REJECTED', reasonCodes: ['PUBLIC_ORACLE_V2_FAILURE']}
        : {jobStatus: 'COMPLETED', decision: actualBlindResult === 'PASS' ? 'ACCEPTED' : 'REJECTED',
          reasonCodes: actualBlindResult === 'PASS' ? ['ALL_GATES_PASS'] : ['SEALED_SEMANTIC_FAILURE']};
    const declaredCandidateResult = options.operationalAsReject ? {jobStatus: 'COMPLETED', decision: 'REJECTED', reasonCodes: ['PUBLIC_BUILD_OPERATIONAL_FAILURE']}
      : options.reasonMislabel ? {...candidateResult, reasonCodes: ['PUBLIC_CONTRACT_FAILURE']} : candidateResult;
    const reasonCodes = declaredCandidateResult.reasonCodes;
    const model = options.modelConflict ? 'nvidia/other-model' : providerMeta.requestedModel;
    const requestId = options.requestIdConflict ? 'request-other' : providerMeta.requestId;
    const modelRequestPackageSha256 = options.requestHashConflict ? hash('e') : requestRef.sha256;
    const declaredBackend = options.sandboxLabel ? 'NEBIUS_SANDBOX' : backend;
    const integrity = publicFailure ? 'INCOMPLETE' : 'PASS';
    const milestone = 'CAT_P05S_BLOCKED';
    const common = {runId, candidateHash, candidateResult: declaredCandidateResult, candidateAccepted: declaredCandidateResult.decision === 'ACCEPTED',
      experimentIntegrity: integrity, milestone, jobStatus: declaredCandidateResult.jobStatus, decision: declaredCandidateResult.decision, reasonCodes,
      status: milestone, executionBackend: declaredBackend, sandboxStatus: probe.status, sandboxOperationId: null,
      sandboxEvidenceSha256: probe.evidenceSha256, candidateFrozenAt: publicFailure ? null : frozenAt, frozenCandidateHash: publicFailure ? null : candidateHash,
      seedCreatedAt: publicFailure ? null : seedAt, holdoutCreatedAt: publicFailure ? null : sealedAt,
      holdoutSeal: holdoutRef?.sha256 ?? null, holdoutChallengeCount: challenges.length,
      blindResult: declaredBlindResult, provider: 'Nebius', baseEndpoint: providerMeta.baseEndpoint, requestEndpoint: providerMeta.requestEndpoint,
      model, returnedModel: providerMeta.returnedModel, requestId, operationId: providerMeta.operationId, finishReason: 'stop', usage: providerMeta.usage,
      networkAttempts: 1, recoveredNetworkCause: 'NONE', requestPackageSha256: requestRef.sha256,
      modelRequestPackageSha256, responseSha256: responseRef.sha256, validatedResponseSha256: validatedRef.sha256,
      patchSha256, publicOutcomes: gates.map(({gate, semantic, exitCode}) => ({gate, result: semantic, exitCode}))};
    if (options.oracleFailure) {
      common.candidateResult = {jobStatus: 'COMPLETED', decision: 'REJECTED', reasonCodes: [options.reasonMislabel ? 'PUBLIC_CONTRACT_FAILURE' : 'PUBLIC_ORACLE_V2_FAILURE']};
      common.decision = 'REJECTED'; common.jobStatus = 'COMPLETED'; common.candidateAccepted = false;
      common.reasonCodes = common.candidateResult.reasonCodes; common.experimentIntegrity = 'INCOMPLETE'; common.milestone = 'CAT_P05S_BLOCKED'; common.status = common.milestone;
      common.blindResult = 'NOT_RUN'; common.candidateFrozenAt = null; common.frozenCandidateHash = null; common.seedCreatedAt = null;
      common.holdoutCreatedAt = null; common.holdoutSeal = null; common.holdoutChallengeCount = 0;
    }
    const publicRun = {...common, backend, operationalFailure: null, implementationSha: binding.implementationSha,
      implementationTreeSha: binding.implementationTreeSha, implementationFiles: binding.implementationFiles};
    const projectionSummary = putPublic('projection-summary', canonical({projection: 'public'}));
    const publicRunRef = putPublic('public-run-summary', canonical(publicRun));
    const publicObjects = [projectionSummary, modelCatalog, publicRunRef];
    const patchApplication = {changedPaths: [REPAIR_MODIFIABLE_PATH], baseFileSha256: base.sha256, resultFileSha256: fileSha256, patchSha256};
    const privateInput = {...binding, runId, candidateHash, candidateResult: common.candidateResult,
      candidateAccepted: common.candidateAccepted, experimentIntegrity: common.experimentIntegrity, milestone: common.milestone,
      jobStatus: common.jobStatus, decision: common.decision, reasonCodes: common.reasonCodes, blindResult: common.blindResult,
      holdoutChallengeCount: common.holdoutChallengeCount, candidateFrozenAt: common.candidateFrozenAt,
      frozenCandidateHash: common.frozenCandidateHash, seedCreatedAt: common.seedCreatedAt, holdoutCreatedAt: common.holdoutCreatedAt,
      holdoutSeal: common.holdoutSeal, state: common.jobStatus, stage: 'receipt', operationalFailure: null,
      provider: providerMeta, patchApplication, modelResponseObjectId: responseRef.id,
      modelResponseContentObjectId: privateRefs.find((item) => item.role === 'model-response-content')!.id, modelRequestObjectId: requestRef.id,
      publicEvidence: gates, publicGateEvidenceSha256: gateRef.sha256, frozenCandidateManifestSha256: frozenRef?.sha256 ?? null,
      holdoutObjectId: holdoutRef?.id ?? null, executionBackend: declaredBackend, sandboxStatus: probe.status, sandboxOperationId: null,
      sandboxEvidenceSha256: probe.evidenceSha256, sandboxBlockerReason: probe.reason,
      lifecycleEventsSha256: lifecycleRef.sha256, dockerEvidenceSha256: dockerRef.sha256,
      requestPackageSha256: requestRef.sha256, modelRequestPackageSha256, responseSha256: responseRef.sha256,
      validatedResponseSha256: validatedRef.sha256, dependencyTreeSha256: hash('d'), objects: privateRefs};
    const privateReceipt = store.createPrivateReceipt(privateInput);
    const publicReceipt = store.createPublicReceipt({...binding, ...common, publicObjects}, privateReceipt.object);
    return {store, privateReceipt, publicReceipt, privateInput, privateRefs, publicObjects, source, projection};
  } finally { projection.cleanup(); }
}

test('rejected public-gate receipt serializes and verifies without frozen evidence', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-rejected-receipt-'));
  const source = fakeImplementationSource();
  try {
    const runId = '8dd11111-1111-4111-8111-111111111111';
    const rejected = completeTypedReceiptFixture(tempRoot, runId, source, {oracleFailure: true});
    const privateText = rejected.privateReceipt.bytes.toString('utf8');
    const publicText = rejected.publicReceipt.bytes.toString('utf8');
    const privateReceipt = JSON.parse(privateText);
    const publicReceipt = JSON.parse(publicText);

    assert.equal(privateReceipt.frozenCandidateManifestSha256, null);
    assert.equal(rejected.privateRefs.some((item: any) => item.role === 'frozen-candidate-manifest'), false);
    assert.equal(rejected.privateRefs.some((item: any) => item.role === 'sealed-holdout'), false);
    assert.equal(rejected.privateRefs.some((item: any) => item.role === 'blind-gate-evidence'), false);
    assert.ok(rejected.privateRefs.some((item: any) => item.role === 'model-request-package'));
    assert.ok(rejected.privateRefs.some((item: any) => item.role === 'validated-model-response'));
    assert.equal(privateReceipt.patchApplication.changedPaths[0], REPAIR_MODIFIABLE_PATH);
    assert.equal(privateReceipt.blindResult, 'NOT_RUN');
    assert.equal(privateReceipt.jobStatus, 'COMPLETED');
    assert.equal(privateReceipt.decision, 'REJECTED');
    assert.equal(privateReceipt.candidateAccepted, false);
    assert.equal(privateReceipt.experimentIntegrity, 'INCOMPLETE');
    assert.equal(privateReceipt.milestone, 'CAT_P05S_BLOCKED');
    assert.deepEqual(privateReceipt.candidateResult.reasonCodes, ['PUBLIC_ORACLE_V2_FAILURE']);
    assert.equal(publicReceipt.privateReceipt.sha256, rejected.privateReceipt.object.sha256);
    assert.doesNotMatch(privateText, /"frozenCandidateManifestSha256"\s*:\s*undefined/);
    assert.doesNotMatch(publicText, /\bundefined\b/);

    const verified = verifyV5Receipt(tempRoot, runId, rejected.publicReceipt.object.sha256, source);
    assert.equal(verified.verified, true);
    assert.match(readFileSync(path.join(root, 'scripts/cat-repair.ts'), 'utf8'),
      /frozenCandidateManifestSha256:[^\r\n]*\?\.sha256 \?\? null,/);

    const frozen = completeTypedReceiptFixture(tempRoot, '9ee11111-1111-4111-8111-111111111111', source);
    assert.equal(frozen.privateInput.frozenCandidateManifestSha256,
      frozen.privateRefs.find((item: any) => item.role === 'frozen-candidate-manifest')?.sha256);
    assert.notEqual(frozen.privateInput.frozenCandidateManifestSha256, null);
  } finally { rmSync(tempRoot, {recursive: true, force: true}); }
});

test('receipt fix leaves canonical undefined serialization semantics unchanged', () => {
  assert.equal(canonical(undefined) as unknown, undefined);
});

test('execution clock envelope accepts only ordered observations within the bounded skew', () => {
  const start = Date.parse('2026-01-01T00:00:00.000Z');
  const finish = start + 1000;
  const envelope = (observationStart: number, observationFinish: number, hostStart = '2026-01-01T00:00:00.000Z',
    hostFinish = '2026-01-01T00:00:01.000Z') => withinExecutionClockEnvelope(observationStart, observationFinish, hostStart, hostFinish);
  assert.equal(envelope(start + 100, start + 900), true, 'CLOCK-1 inside envelope');
  assert.equal(envelope(start + 900, finish + 196), true, 'CLOCK-2 finish +196 ms');
  assert.equal(envelope(start - 196, start + 900), true, 'CLOCK-3 start -196 ms');
  assert.equal(envelope(start + 100, finish + 2000), true, 'CLOCK-4 exact +2000 ms');
  assert.equal(envelope(start - 2000, start + 900), true, 'CLOCK-5 exact -2000 ms');
  assert.equal(envelope(start + 100, finish + 2001), false, 'CLOCK-6 +2001 ms');
  assert.equal(envelope(start - 2001, start + 900), false, 'CLOCK-7 -2001 ms');
  assert.equal(envelope(start + 900, start + 899), false, 'CLOCK-8 finish before start');
  assert.equal(envelope(start + 100, start + 900, 'invalid', '2026-01-01T00:00:01.000Z'), false, 'CLOCK-9 invalid host timestamp');
  assert.equal(envelope(start + 100, start + 900, '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:00.000Z'), false,
    'CLOCK-10 host finish before start');
  assert.equal(envelope(start - 2000, finish + 2000), true, 'maximum two-sided duration remains bounded');
  assert.equal(envelope(start + 100, start + 30_100), false, '30-second displacement fails');
  assert.equal(envelope(Number.NaN, start + 900), false, 'non-finite observation timestamp fails');
});

test('clock skew tolerance preserves public evidence binding and strict blind host ordering', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-clock-envelope-'));
  const source = fakeImplementationSource();
  let caseIndex = 0;
  const verify = (clock: NonNullable<Parameters<typeof completeTypedReceiptFixture>[3]>['clock'], pass: boolean) => {
    const runId = `aa111111-1111-4111-8111-${String(++caseIndex).padStart(12, '0')}`;
    const fixture = completeTypedReceiptFixture(tempRoot, runId, source, {clock});
    if (pass) assert.equal(verifyV5Receipt(tempRoot, runId, fixture.publicReceipt.object.sha256, source).verified, true);
    else assert.throws(() => verifyV5Receipt(tempRoot, runId, fixture.publicReceipt.object.sha256, source));
  };
  try {
    verify({}, true);
    verify({publicFinishOffsetMs: 196}, true);
    verify({publicStartOffsetMs: -196}, true);
    verify({publicFinishOffsetMs: 2000}, true);
    verify({publicStartOffsetMs: -2000}, true);
    verify({publicFinishOffsetMs: 2001}, false);
    verify({publicStartOffsetMs: -2001}, false);
    verify({hostFinishBeforeStart: true}, false);
    verify({invalidHostStart: true}, false);
    verify({invalidObservationStart: true}, false);
    verify({publicRowStartDeltaMs: 1}, false);
    verify({publicOutputShaMismatch: true}, false);
    verify({publicRuntimeShaMismatch: true}, false);
    verify({publicObservationConflict: true}, false);
    verify({publicExecutionIdMismatch: true}, false);
    verify({dockerExecutionIdMismatch: true}, false);
    verify({publicFinishOffsetMs: 30_000}, false);
    verify({blindHostStartBeforeSealMs: 1}, false);
    verify({blindStartOffsetMs: 196, blindFinishOffsetMs: 196}, true);
    verify({blindFinishOffsetMs: 2001}, false);
    verify({blindLifecycleBeforeSeal: true}, false);
  } finally { rmSync(tempRoot, {recursive: true, force: true}); }
});

test('v5 verifier derives blind semantics and rejects contradictory evidence summaries', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-receipt-semantics-'));
  const source = fakeImplementationSource();
  try {
    const valid = completeTypedReceiptFixture(root, '5ee11111-1111-4111-8111-111111111111', source);
    assert.equal(verifyV5Receipt(root, '5ee11111-1111-4111-8111-111111111111', valid.publicReceipt.object.sha256, source).verified, true);
    const contradiction = completeTypedReceiptFixture(root, '6ff11111-1111-4111-8111-111111111111', source, {blindSummary: 'FAIL'});
    assert.throws(() => verifyV5Receipt(root, '6ff11111-1111-4111-8111-111111111111', contradiction.publicReceipt.object.sha256, source), /RECEIPT_RESULT_SEMANTICS_INVALID/);
    const semanticFail = completeTypedReceiptFixture(root, '7aa11111-1111-4111-8111-111111111111', source, {blindFail: true});
    assert.equal(verifyV5Receipt(root, '7aa11111-1111-4111-8111-111111111111', semanticFail.publicReceipt.object.sha256, source).verified, true);
    const beforeSeal = completeTypedReceiptFixture(root, '8bb11111-1111-4111-8111-111111111111', source, {blindBeforeSeal: true});
    assert.throws(() => verifyV5Receipt(root, '8bb11111-1111-4111-8111-111111111111', beforeSeal.publicReceipt.object.sha256, source), /RECEIPT_BLIND_BEFORE_SEAL/);
    const forgedTime = completeTypedReceiptFixture(root, '8bc11111-1111-4111-8111-111111111111', source, {blindBeforeSeal: true, forgePostSealBlindTimestamp: true});
    assert.throws(() => verifyV5Receipt(root, '8bc11111-1111-4111-8111-111111111111', forgedTime.publicReceipt.object.sha256, source), /RECEIPT_BLIND_BEFORE_SEAL/);
    const earlyDocker = completeTypedReceiptFixture(root, '8bd11111-1111-4111-8111-111111111111', source, {dockerBeforeSealObservationAfter: true});
    assert.throws(() => verifyV5Receipt(root, '8bd11111-1111-4111-8111-111111111111', earlyDocker.publicReceipt.object.sha256, source), /RECEIPT_BLIND_BEFORE_SEAL/);
    const missing = completeTypedReceiptFixture(root, '9cc11111-1111-4111-8111-111111111111', source, {missingBlindRow: true});
    assert.throws(() => verifyV5Receipt(root, '9cc11111-1111-4111-8111-111111111111', missing.publicReceipt.object.sha256, source), /RECEIPT_BLIND_CHALLENGE_SET_INVALID/);
    const duplicate = completeTypedReceiptFixture(root, '0dd11111-1111-4111-8111-111111111111', source, {duplicateBlindRow: true});
    assert.throws(() => verifyV5Receipt(root, '0dd11111-1111-4111-8111-111111111111', duplicate.publicReceipt.object.sha256, source), /RECEIPT_BLIND_ROW_BINDING_INVALID/);
    const cleanup = completeTypedReceiptFixture(root, '1ee11111-1111-4111-8111-111111111111', source, {cleanupFailure: true});
    assert.throws(() => verifyV5Receipt(root, '1ee11111-1111-4111-8111-111111111111', cleanup.publicReceipt.object.sha256, source), /RECEIPT_DOCKER_LIFECYCLE_INVALID/);
    const sandbox = completeTypedReceiptFixture(root, '2ff11111-1111-4111-8111-111111111111', source, {sandboxLabel: true});
    assert.throws(() => verifyV5Receipt(root, '2ff11111-1111-4111-8111-111111111111', sandbox.publicReceipt.object.sha256, source), /RECEIPT_SANDBOX_BACKEND_UNVERIFIED/);
    const model = completeTypedReceiptFixture(root, '3aa11111-1111-4111-8111-111111111111', source, {modelConflict: true});
    assert.throws(() => verifyV5Receipt(root, '3aa11111-1111-4111-8111-111111111111', model.publicReceipt.object.sha256, source), /RECEIPT_PROVIDER_SUMMARY_MISMATCH/);
    const requestId = completeTypedReceiptFixture(root, '4bb11111-1111-4111-8111-111111111111', source, {requestIdConflict: true});
    assert.throws(() => verifyV5Receipt(root, '4bb11111-1111-4111-8111-111111111111', requestId.publicReceipt.object.sha256, source), /RECEIPT_PROVIDER_SUMMARY_MISMATCH/);
    const providerEnvelope = completeTypedReceiptFixture(root, '4bc11111-1111-4111-8111-111111111111', source, {providerEnvelopeModelConflict: true});
    assert.throws(() => verifyV5Receipt(root, '4bc11111-1111-4111-8111-111111111111', providerEnvelope.publicReceipt.object.sha256, source), /RECEIPT_PROVIDER_BINDING_INVALID/);
    const requestHash = completeTypedReceiptFixture(root, '5cc11111-1111-4111-8111-111111111111', source, {requestHashConflict: true});
    assert.throws(() => verifyV5Receipt(root, '5cc11111-1111-4111-8111-111111111111', requestHash.publicReceipt.object.sha256, source), /RECEIPT_PROVIDER_BINDING_INVALID/);
    const duplicateRequest = completeTypedReceiptFixture(root, '5cd11111-1111-4111-8111-111111111111', source, {networkAttempts: 2});
    assert.throws(() => verifyV5Receipt(root, '5cd11111-1111-4111-8111-111111111111', duplicateRequest.publicReceipt.object.sha256, source), /RECEIPT_PROVIDER_BINDING_INVALID/);
    const publicReject = completeTypedReceiptFixture(root, '6dd11111-1111-4111-8111-111111111111', source, {oracleFailure: true});
    assert.equal(verifyV5Receipt(root, '6dd11111-1111-4111-8111-111111111111', publicReject.publicReceipt.object.sha256, source).verified, true);
    const reason = completeTypedReceiptFixture(root, '6ee11111-1111-4111-8111-111111111111', source, {oracleFailure: true, reasonMislabel: true});
    assert.throws(() => verifyV5Receipt(root, '6ee11111-1111-4111-8111-111111111111', reason.publicReceipt.object.sha256, source), /RECEIPT_RESULT_SEMANTICS_INVALID/);
    const operational = completeTypedReceiptFixture(root, '7ee11111-1111-4111-8111-111111111111', source, {operationalAsReject: true});
    assert.throws(() => verifyV5Receipt(root, '7ee11111-1111-4111-8111-111111111111', operational.publicReceipt.object.sha256, source), /RECEIPT_RESULT_SEMANTICS_INVALID/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

function gateEvidence(gate: string, candidateHash: string, semantic: GateEvidence['semantic'] = 'PASS', exitCode = 0, runtimeSha256 = hash('f')): GateEvidence {
  return {gate, candidateHash, backend: 'LOCAL_DOCKER_FALLBACK', command: ['fixed-command'], exitCode, outputSha256: hash('a'), runtimeSha256, semantic};
}

function productionLifecycle(root: string, now: () => string, holdoutState: {created: boolean}) {
  const backend: RepairBackend = 'LOCAL_DOCKER_FALLBACK';
  return createRepairLifecycle({workspaceHash: hash('a'), baseCandidateHash: hash('b'), publicOracleHash: hash('c'), implementationSha: hash('d'),
    implementationTreeSha: hash('e'), implementationFiles: [{path: 'scripts/cat-repair.ts', sha256: hash('0')}],
    candidateRoot: root, backend, now, persistFrozen: (_frozen, record) => record.candidateHash,
    createHoldout: () => { holdoutState.created = true; const seedCreatedAt = now(); const bytes = Buffer.from('{"challenges":[{}]}');
      return {bytes, seal: createHash('sha256').update(bytes).digest('hex'), challengeCount: 1, generatorVersion: 'positive-expiry-v1', seedCreatedAt, createdAt: now()}; },
    persistHoldout: (holdout) => holdout.seal});
}

test('production lifecycle requires public evidence, durably freezes before lazy holdout, and completes blind verification', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-prod-life-'));
  const file = path.join(root, 'candidate.coffee');
  writeFileSync(file, 'candidate');
  let time = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, time++)).toISOString();
  const holdoutState = {created: false};
  const lifecycle = productionLifecycle(root, now, holdoutState);
  try {
    const candidateHash = hashRepairTree(root);
    lifecycle.recordModelResult({requestSha256: hash('1'), responseSha256: hash('2'), validatedResponseSha256: hash('3'), patchSha256: hash('4')});
    lifecycle.applyCandidate(candidateHash);
    assert.throws(() => lifecycle.createAndSealHoldout(), /REPAIR_LIFECYCLE_INVALID_TRANSITION/);
    assert.equal(holdoutState.created, false);
    const gates = ['build', 'existing-suite', 'public-contract', 'public-oracle-v2'].map((name) => gateEvidence(name, candidateHash));
    assert.equal(lifecycle.evaluatePublic(gates).outcome, 'PASS');
    const frozen = lifecycle.freezeCandidate();
    assert.equal(frozen.candidateHash, candidateHash);
    assert.equal(holdoutState.created, false);
    lifecycle.createAndSealHoldout();
    assert.equal(holdoutState.created, true);
    assert.throws(() => lifecycle.recordModelResult({requestSha256: hash('1'), responseSha256: hash('2'), validatedResponseSha256: hash('3'), patchSha256: hash('4')}), /REPAIR_LIFECYCLE_INVALID_TRANSITION/);
    lifecycle.verifyBlind(() => gateEvidence('sealed-holdout', candidateHash));
    assert.equal(lifecycle.snapshot().state, 'COMPLETED');
    assert.equal(lifecycle.snapshot().decision, 'ACCEPTED');
  } finally { lifecycle.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('production lifecycle permanently invalidates a mutated frozen candidate', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-prod-mutation-'));
  const file = path.join(root, 'candidate.coffee');
  writeFileSync(file, 'candidate');
  let tick = 0;
  const lifecycle = productionLifecycle(root, () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(), {created: false});
  try {
    const candidateHash = hashRepairTree(root);
    lifecycle.recordModelResult({requestSha256: hash('1'), responseSha256: hash('2'), validatedResponseSha256: hash('3'), patchSha256: hash('4')});
    lifecycle.applyCandidate(candidateHash);
    lifecycle.evaluatePublic(['build', 'existing-suite', 'public-contract', 'public-oracle-v2'].map((gate) => gateEvidence(gate, candidateHash)));
    lifecycle.freezeCandidate();
    lifecycle.createAndSealHoldout();
    assert.throws(() => lifecycle.verifyBlind(({frozenCandidateRoot}) => {
      const target = path.join(frozenCandidateRoot, 'candidate.coffee');
      chmodSync(target, 0o600);
      writeFileSync(target, 'mutated');
      return gateEvidence('sealed-holdout', candidateHash);
    }), /FROZEN_CANDIDATE_MUTATED/);
    assert.equal(lifecycle.snapshot().state, 'INVALID');
    assert.throws(() => lifecycle.verifyBlind(() => gateEvidence('sealed-holdout', candidateHash)), /REPAIR_LIFECYCLE_INVALID_TRANSITION/);
  } finally { lifecycle.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('production lifecycle keeps sealed semantic failure distinct from blind execution failure', () => {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
  for (const [semantic, exitCode, expected] of [['FAIL', 0, 'REJECTED'], ['ERROR', 1, 'INCONCLUSIVE']] as const) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-prod-blind-'));
    writeFileSync(path.join(root, 'candidate.coffee'), 'candidate');
    const lifecycle = productionLifecycle(root, now, {created: false});
    try {
      const candidateHash = hashRepairTree(root);
      lifecycle.recordModelResult({requestSha256: hash('1'), responseSha256: hash('2'), validatedResponseSha256: hash('3'), patchSha256: hash('4')});
      lifecycle.applyCandidate(candidateHash);
      lifecycle.evaluatePublic(['build', 'existing-suite', 'public-contract', 'public-oracle-v2'].map((gate) => gateEvidence(gate, candidateHash)));
      const frozen = lifecycle.freezeCandidate();
      lifecycle.createAndSealHoldout();
      const evidence = {...gateEvidence('sealed-holdout', frozen.candidateHash, semantic, exitCode), candidateHash: frozen.candidateHash};
      assert.equal(lifecycle.verifyBlind(() => evidence).decision, expected);
    } finally { lifecycle.dispose(); rmSync(root, {recursive: true, force: true}); }
  }
});

test('production lifecycle distinguishes semantic rejection from execution uncertainty', () => {
  for (const [exitCode, semantic, expected] of [[0, 'FAIL', 'REJECTED'], [1, 'ERROR', 'INCONCLUSIVE']] as const) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-prod-result-'));
    writeFileSync(path.join(root, 'candidate.coffee'), 'candidate');
    const lifecycle = productionLifecycle(root, () => new Date().toISOString(), {created: false});
    try {
      const candidateHash = hashRepairTree(root);
      lifecycle.recordModelResult({requestSha256: hash('1'), responseSha256: hash('2'), validatedResponseSha256: hash('3'), patchSha256: hash('4')});
      lifecycle.applyCandidate(candidateHash);
      const gates = ['build', 'existing-suite', 'public-contract', 'public-oracle-v2'].map((gate, index) => gateEvidence(gate, candidateHash, index === 0 ? semantic : 'PASS', index === 0 ? exitCode : 0));
      const outcome = lifecycle.evaluatePublic(gates);
      assert.equal(outcome.decision, expected);
      assert.equal(lifecycle.snapshot().state, 'COMPLETED');
    } finally { lifecycle.dispose(); rmSync(root, {recursive: true, force: true}); }
  }
});

test('local Docker fallback remains explicitly local and unverified backend is rejected', () => {
  assert.equal(selectRepairExecutionBackend({sandboxVerified: false, otherNebiusVerified: false, localDockerReady: true}), 'LOCAL_DOCKER_FALLBACK');
  assert.equal(selectRepairExecutionBackend({sandboxVerified: true, otherNebiusVerified: false, localDockerReady: true}), 'NEBIUS_SANDBOX');
  assert.throws(() => selectRepairExecutionBackend({sandboxVerified: false, otherNebiusVerified: false, localDockerReady: false}), /NO_VERIFIED_EXECUTION_BACKEND/);
});

test('projection paths reject traversal, absolute paths, UNC, drive, and ADS forms', () => {
  for (const value of ['../secret', '..\\secret', '/secret', 'C:/secret', 'C:secret', '//server/share', 'candidate/file:stream']) {
    assert.throws(() => normalizeProjectionPath(value), /PROJECTION_PATH_INVALID/);
  }
  assert.throws(() => validateProjectionPaths(['candidate/a', 'candidate/a']), /PROJECTION_PATH_DUPLICATE/);
});

test('allowlisted source resolution rejects symbolic links and escapes', (t) => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-link-test-'));
  try {
    const allowed = path.join(temp, 'allowed');
    const outside = path.join(temp, 'outside');
    mkdirSync(allowed); mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.txt'), 'x');
    try { symlinkSync(path.join(outside, 'secret.txt'), path.join(allowed, 'link.txt'), 'file'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'UNKNOWN'].includes((error as NodeJS.ErrnoException).code ?? '')) return t.skip('symlink creation is unavailable on this platform');
      throw error;
    }
    assert.throws(() => resolveAllowlistedSource(allowed, 'link.txt'), /PROJECTION_SOURCE_ESCAPE|PROJECTION_SOURCE_LINK_REJECTED/);
    try { symlinkSync(outside, path.join(allowed, 'junction'), 'junction'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'UNKNOWN', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) return t.skip('junction creation is unavailable on this platform');
      throw error;
    }
    assert.throws(() => resolveAllowlistedSource(allowed, 'junction/secret.txt'), /PROJECTION_SOURCE_ESCAPE|PROJECTION_SOURCE_LINK_REJECTED/);
  } finally { rmSync(temp, {recursive: true, force: true}); }
});

test('sensitive denylist is hash-only and contains no credentials', () => {
  assert.ok(SENSITIVE_ARTIFACT_DENYLIST.every(({id, sha256}) => id.length > 0 && /^[a-f0-9]{64}$/.test(sha256)));
  assert.ok(SENSITIVE_ARTIFACT_DENYLIST.every(({id}) => !/NEBIUS|TOKEN|SECRET|KEY/i.test(id)));
});

test('repair lifecycle freezes before sealing and rejects all post-seal transitions', () => {
  let tick = 0;
  const candidateRoot = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-candidate-'));
  const candidatePath = path.join(candidateRoot, 'index.js');
  writeFileSync(candidatePath, 'test candidate');
  let holdoutCreated = false;
  const lifecycle = createTestRepairLifecycle({testOnly: true, workspaceHash: hash('a'), baseCandidateHash: hash('b'), candidateRoot,
    publicOracleHash: hash('9'), now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    holdoutGenerator: {testOnly: true, create: () => { holdoutCreated = true; return Buffer.from('{"testOnly":true,"value":"fake"}'); }}});
  try {
    assert.equal(lifecycle.snapshot().state, 'ready');
    assert.equal(lifecycle.snapshot().holdoutSeal, undefined);
    assert.throws(() => lifecycle.sealHoldout(), /LIFECYCLE_INVALID_TRANSITION/);
    assert.equal(holdoutCreated, false);
    lifecycle.recordModelResult({testOnly: true, resultHash: hash('c'), patchHash: hash('8')});
    const candidateHash = hashCandidateTree(candidateRoot);
    lifecycle.applyCandidate({testOnly: true, candidateHash});
    lifecycle.evaluatePublic({testOnly: true, gateHashes: [hash('f'), hash('7')], passed: true});
    const frozen = lifecycle.freezeCandidate();
    assert.equal(frozen.candidateFrozenAt, '2026-01-01T00:00:00.000Z');
    assert.equal(frozen.candidateHash, candidateHash);
    assert.equal(frozen.patchHash, hash('8'));
    assert.equal(frozen.publicOracleHash, hash('9'));
    assert.deepEqual(frozen.publicGateHashes, [hash('7'), hash('f')]);
    assert.equal(lifecycle.snapshot().holdoutSeal, undefined);
    assert.equal(holdoutCreated, false);
    assert.throws(() => lifecycle.applyCandidate({testOnly: true, candidateHash: hash('1')}), /LIFECYCLE_INVALID_TRANSITION/);
    writeFileSync(candidatePath, 'mutated candidate');
    const sealed = lifecycle.sealHoldout();
    assert.equal(sealed.holdoutCreatedAt, '2026-01-01T00:00:01.000Z');
    assert.ok(Date.parse(sealed.holdoutCreatedAt) >= Date.parse(frozen.candidateFrozenAt));
    assert.equal(sealed.holdoutSeal, createHash('sha256').update(Buffer.from('{"testOnly":true,"value":"fake"}')).digest('hex'));
    assert.equal(lifecycle.snapshot().state, 'holdout_sealed');
    assert.equal(holdoutCreated, true);
    assert.throws(() => lifecycle.recordModelResult({testOnly: true, resultHash: hash('1'), patchHash: hash('1')}), /LIFECYCLE_INVALID_TRANSITION/);
    assert.throws(() => lifecycle.verifyBlind({testOnly: true, evaluate: 3} as never), /TEST_BLIND_RESULT_INVALID/);
    assert.throws(() => lifecycle.complete(), /LIFECYCLE_INVALID_TRANSITION/);
    lifecycle.verifyBlind({testOnly: true, evaluate: ({frozenCandidateRoot, holdoutBytes}) => {
      assert.equal(readFileSync(path.join(frozenCandidateRoot, 'index.js'), 'utf8'), 'test candidate');
      assert.equal(holdoutBytes.toString('utf8'), '{"testOnly":true,"value":"fake"}');
      return true;
    }});
    lifecycle.complete();
    assert.equal(lifecycle.snapshot().state, 'completed');
  } finally { lifecycle.dispose(); rmSync(candidateRoot, {recursive: true, force: true}); }
});

test('mutation of the frozen candidate permanently invalidates the run', () => {
  const candidateRoot = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-candidate-'));
  writeFileSync(path.join(candidateRoot, 'index.js'), 'test candidate');
  const lifecycle = createTestRepairLifecycle({testOnly: true, workspaceHash: hash('a'), baseCandidateHash: hash('b'), candidateRoot, publicOracleHash: hash('9')});
  let frozenFile = '';
  try {
    lifecycle.recordModelResult({testOnly: true, resultHash: hash('c'), patchHash: hash('8')});
    lifecycle.applyCandidate({testOnly: true, candidateHash: hashCandidateTree(candidateRoot)});
    lifecycle.evaluatePublic({testOnly: true, gateHashes: [hash('f')], passed: true});
    lifecycle.freezeCandidate();
    lifecycle.sealHoldout();
    assert.throws(() => lifecycle.verifyBlind({testOnly: true, evaluate: ({frozenCandidateRoot}) => {
      frozenFile = path.join(frozenCandidateRoot, 'index.js');
      chmodSync(frozenFile, 0o600);
      writeFileSync(frozenFile, 'tampered frozen candidate');
      throw new Error('simulated evaluator exit');
    }}), /FROZEN_CANDIDATE_MUTATED/);
    assert.equal(lifecycle.snapshot().state, 'invalid');
    chmodSync(frozenFile, 0o600);
    writeFileSync(frozenFile, 'test candidate');
    assert.throws(() => lifecycle.verifyBlind({testOnly: true, evaluate: () => true}), /LIFECYCLE_INVALID_TRANSITION/);
    assert.throws(() => lifecycle.complete(), /LIFECYCLE_INVALID_TRANSITION/);
    assert.throws(() => lifecycle.sealHoldout(), /LIFECYCLE_INVALID_TRANSITION/);
  } finally { lifecycle.dispose(); rmSync(candidateRoot, {recursive: true, force: true}); }
});

test('structural mutation of the frozen candidate cannot be restored to resume the run', () => {
  const candidateRoot = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-candidate-'));
  const candidateFile = path.join(candidateRoot, 'index.js');
  writeFileSync(candidateFile, 'test candidate');
  const lifecycle = createTestRepairLifecycle({testOnly: true, workspaceHash: hash('a'), baseCandidateHash: hash('b'), candidateRoot, publicOracleHash: hash('9')});
  let frozenRoot = '';
  try {
    lifecycle.recordModelResult({testOnly: true, resultHash: hash('c'), patchHash: hash('8')});
    lifecycle.applyCandidate({testOnly: true, candidateHash: hashCandidateTree(candidateRoot)});
    lifecycle.evaluatePublic({testOnly: true, gateHashes: [hash('f')], passed: true});
    lifecycle.freezeCandidate();
    lifecycle.sealHoldout();
    assert.throws(() => lifecycle.verifyBlind({testOnly: true, evaluate: ({frozenCandidateRoot}) => {
      frozenRoot = frozenCandidateRoot;
      chmodSync(frozenRoot, 0o700);
      unlinkSync(path.join(frozenRoot, 'index.js'));
      return true;
    }}), /FROZEN_CANDIDATE_MUTATED/);
    assert.equal(lifecycle.snapshot().state, 'invalid');
    writeFileSync(path.join(frozenRoot, 'index.js'), 'test candidate');
    chmodSync(path.join(frozenRoot, 'index.js'), 0o400);
    chmodSync(frozenRoot, 0o500);
    assert.throws(() => lifecycle.verifyBlind({testOnly: true, evaluate: () => true}), /LIFECYCLE_INVALID_TRANSITION/);
    assert.throws(() => lifecycle.complete(), /LIFECYCLE_INVALID_TRANSITION/);
  } finally { lifecycle.dispose(); rmSync(candidateRoot, {recursive: true, force: true}); }
});

test('repair lifecycle requires test-only inputs and forbids blind verification before sealing', () => {
  const candidateRoot = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-candidate-'));
  writeFileSync(path.join(candidateRoot, 'index.js'), 'test candidate');
  try {
    assert.throws(() => createTestRepairLifecycle({testOnly: false, workspaceHash: hash('a'), baseCandidateHash: hash('b'), candidateRoot, publicOracleHash: hash('9')} as never), /TEST_ONLY_LIFECYCLE_REQUIRED/);
    const lifecycle = createTestRepairLifecycle({testOnly: true, workspaceHash: hash('a'), baseCandidateHash: hash('b'), candidateRoot, publicOracleHash: hash('9')});
    assert.throws(() => lifecycle.verifyBlind({testOnly: true, evaluate: () => true}), /LIFECYCLE_INVALID_TRANSITION/);
    assert.equal(decideFinal({operationalError: true, publicPass: true, holdoutStatus: 'UNAVAILABLE'}), 'INCONCLUSIVE');
  } finally { rmSync(candidateRoot, {recursive: true, force: true}); }
});
