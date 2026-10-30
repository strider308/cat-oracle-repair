import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {assertResultShape, canAccept, validateAcceptance, type CandidateResult} from '../src/core/result.ts';
import {canonicalReceiptJson, finalizeReceipt, hashReceipt, verifyReceipt, type AcceptanceReceipt} from '../src/core/receipt.ts';
import {buildTokenFactoryObservationBody, formatTokenFactoryNetworkDiagnostic, getTokenFactoryFailureDiagnostic, isNvidiaModel, listTokenFactoryModels, parseTokenFactoryModels, parseTokenFactorySmokeResponse, readJsonBounded, resolveTokenFactoryBaseUrl, resolveTokenFactoryFailureCode, runTokenFactoryJsonSchemaRequest, runTokenFactorySmoke, selectNvidiaModels, tokenFactoryHttpError, tokenFactoryNetworkError, TokenFactoryError} from '../src/runtime/nebius.ts';
import {selectRepairModel} from '../src/repair/provider.ts';
import {consumeInferenceAuthorization, createInferenceAuthorizationProposal, INFERENCE_IMPLEMENTATION_FILES} from '../src/runtime/inference-authorization.ts';

const candidateSha = 'candidate-123';
const contractHash = 'contract-456';
const evidenceManifestHash = 'a'.repeat(64);

function authorizationFixture(request: Parameters<typeof createInferenceAuthorizationProposal>[0]) {
  const root = mkdtempSync(path.join(path.resolve(import.meta.dirname, '..'), '.verification-runs', 'cat-inference-auth-'));
  const run = (args: string[]) => execFileSync('git', args, {cwd: root, windowsHide: true}).toString('utf8').trim();
  mkdirSync(path.join(root, 'src/runtime'), {recursive: true});
  for (const file of INFERENCE_IMPLEMENTATION_FILES) {
    const source = path.resolve(import.meta.dirname, '..', file);
    const destination = path.join(root, ...file.split('/'));
    mkdirSync(path.dirname(destination), {recursive: true});
    writeFileSync(destination, readFileSync(source));
  }
  writeFileSync(path.join(root, '.gitignore'), '.agent-runs/\n');
  run(['init', '-b', 'release']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'CAT test']);
  run(['add', '.']);
  run(['commit', '-m', 'fixture']);
  run(['remote', 'add', 'origin', 'https://example.invalid/cat.git']);
  run(['config', 'branch.release.remote', 'origin']);
  run(['update-ref', 'refs/remotes/origin/release', 'HEAD']);
  const authDir = path.join(root, '.agent-runs', 'inference-authorizations');
  mkdirSync(authDir, {recursive: true});
  const authorizationFile = path.join(authDir, 'request.json');
  const proposal = createInferenceAuthorizationProposal(request, 'authorization-test', request.operationId, root);
  Object.assign(proposal, {status: 'approved', ownerReference: 'owner-reference-test', approvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(), authorizedPostCount: 1, residualBillingRiskAccepted: true});
  writeFileSync(authorizationFile, JSON.stringify(proposal));
  return {root, authorizationFile, marker: `${authorizationFile}.consumed`, cleanup: () => rmSync(root, {recursive: true, force: true})};
}


function validResult(): CandidateResult {
  return {
    candidateSha,
    contractHash,
    jobStatus: 'COMPLETED',
    decision: 'ACCEPTED',
    reasonCodes: [],
    requiredGateIds: ['existing-suite', 'acceptance'],
    gates: {'existing-suite': 'PASS', acceptance: 'PASS'},
    evidenceManifestHash,
  };
}

const context = {expectedCandidateSha: candidateSha, expectedContractHash: contractHash};

const authorizationRequest = {
  operationId: '550e8400-e29b-41d4-a716-446655440000',
  purpose: 'smoke' as const,
  endpoint: 'https://api.tokenfactory.nebius.com/v1/chat/completions',
  model: 'nvidia/example-model',
  body: '{"model":"nvidia/example-model"}',
  packageSha256: createHash('sha256').update('{"model":"nvidia/example-model"}').digest('hex'),
  accountReference: 'account-reference-test', timeoutMs: 15000, maxOutputTokens: 256, maxResponseBytes: 1024 * 1024,
};

test('a locally writable ownerReference cannot authenticate an inference authorization', () => {
  const fixture = authorizationFixture(authorizationRequest);
  try {
    assert.throws(() => consumeInferenceAuthorization(authorizationRequest, fixture.authorizationFile, fixture.root), /INFERENCE_AUTHENTICATED_OWNER_APPROVAL_UNAVAILABLE/);
    assert.equal(existsSync(fixture.marker), false);
  } finally { fixture.cleanup(); }
});

test('unsigned authorization remains blocked regardless of locally supplied request fields', () => {
  const fixture = authorizationFixture(authorizationRequest);
  try {
    for (const changed of [
      {...authorizationRequest, model: 'nvidia/other'},
      {...authorizationRequest, body: '{"model":"substituted"}'},
      {...authorizationRequest, accountReference: 'other-account'},
    ]) assert.throws(() => consumeInferenceAuthorization(changed, fixture.authorizationFile, fixture.root), /INFERENCE_AUTHENTICATED_OWNER_APPROVAL_UNAVAILABLE/);
  } finally { fixture.cleanup(); }
});

test('accepts only a completed, hash-bound candidate with every required gate passing', () => {
  const result = validResult();
  assertResultShape(result);
  assert.equal(canAccept(result, context), true);
});

test('fails closed when a required gate is missing', () => {
  const result = validResult();
  delete result.gates.acceptance;
  const check = validateAcceptance(result, context);
  assert.equal(check.ok, false);
  assert.deepEqual(check.errors, ['MISSING_REQUIRED_GATE:acceptance']);
});

test('fails closed on zero required gates', () => {
  const result = validResult();
  result.requiredGateIds = [];
  const check = validateAcceptance(result, context);
  assert.equal(check.ok, false);
  assert.ok(check.errors.includes('NO_REQUIRED_GATES'));
});

test('does not treat NOT_APPLICABLE as PASS for a required gate', () => {
  const result = validResult();
  result.gates.acceptance = 'NOT_APPLICABLE';
  const check = validateAcceptance(result, context);
  assert.equal(check.ok, false);
  assert.ok(check.errors.includes('REQUIRED_GATE_NOT_PASS:acceptance:NOT_APPLICABLE'));
});

test('rejects stale candidate or contract bindings', () => {
  const result = validResult();
  const check = validateAcceptance(result, {
    expectedCandidateSha: 'different-candidate',
    expectedContractHash: 'different-contract',
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.includes('STALE_OR_MISMATCHED_CANDIDATE_SHA'));
  assert.ok(check.errors.includes('STALE_OR_MISMATCHED_CONTRACT_HASH'));
});

test('operational incompletion cannot masquerade as semantic acceptance', () => {
  const result = validResult();
  result.jobStatus = 'INCONCLUSIVE';
  result.decision = null;
  assertResultShape(result);
  const check = validateAcceptance(result, context);
  assert.equal(check.ok, false);
  assert.ok(check.errors.includes('JOB_NOT_COMPLETED'));
  assert.ok(check.errors.includes('DECISION_NOT_ACCEPTED'));
});

test('result shape rejects semantic decisions on running jobs', () => {
  const result = validResult();
  result.jobStatus = 'RUNNING';
  assert.throws(() => assertResultShape(result), /running jobs cannot have a semantic decision/);
});

test('receipt hash is deterministic and detects evidence mutation', () => {
  const receipt: AcceptanceReceipt = {
    runId: 'run-1',
    createdAt: '2026-10-06T12:00:00.000Z',
    baseSha: 'base-1',
    candidate: validResult(),
    environmentDigest: 'sha256:env',
    sourceHashes: {contract: contractHash},
    commands: ['npm test'],
    modelIds: [],
    providerOperationIds: [],
    knownLimits: ['WP2 core only'],
    previousEventHash: null,
  };

  const finalized = finalizeReceipt(receipt);
  assert.equal(verifyReceipt(finalized), true);

  const mutated = structuredClone(finalized);
  mutated.candidate.gates.acceptance = 'FAIL';
  assert.equal(verifyReceipt(mutated), false);
});

test('receipt canonicalization uses locale-independent key order', () => {
  const receipt = {sourceHashes: {'ä': 'umlaut', z: 'zed'}} as unknown as AcceptanceReceipt;
  const canonical = '{"sourceHashes":{"z":"zed","ä":"umlaut"}}';
  assert.equal(canonicalReceiptJson(receipt), canonical);
  assert.equal(hashReceipt(receipt), createHash('sha256').update(canonical).digest('hex'));
});

test('receipt hashing excludes only the top-level receipt hash', () => {
  const receipt: AcceptanceReceipt = {
    runId: 'run-nested-hash',
    createdAt: '2026-10-06T12:00:00.000Z',
    baseSha: 'base-1',
    candidate: validResult(),
    environmentDigest: 'sha256:env',
    sourceHashes: {contract: contractHash},
    commands: ['npm test'],
    modelIds: [],
    providerOperationIds: [],
    knownLimits: [],
    previousEventHash: null,
  };
  const metadata = {receiptHash: 'nested-value'};
  Object.assign(receipt, {metadata});

  const finalized = finalizeReceipt(receipt);
  assert.equal(verifyReceipt(finalized), true);
  metadata.receiptHash = 'mutated-value';
  assert.equal(verifyReceipt(finalized), false);
});

test('provider discovery identifies NVIDIA/Nemotron candidates without hardcoded model IDs', () => {
  const models = [
    {id: 'vendor/general-model', owned_by: 'system'},
    {id: 'nvidia/example-model', owned_by: 'system'},
    {id: 'vendor/nemotron-example', owned_by: 'system'},
  ];
  assert.equal(isNvidiaModel(models[0]), false);
  assert.deepEqual(selectNvidiaModels(models).map((model) => model.id), [
    'nvidia/example-model',
    'vendor/nemotron-example',
  ]);
});

test('repair selector chooses exact Super before other approved models', () => {
  assert.equal(selectRepairModel([
    {id: 'nvidia/nemotron-3-super-120b-a12b'},
    {id: 'nvidia/Nemotron-3_5-Lightning'},
    {id: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B'},
  ]).id, 'nvidia/nemotron-3-super-120b-a12b');
});

test('repair selector rejects alternate casing and fallback models', () => {
  for (const id of [
    'nvidia/Nemotron-3-Super-120B-A12B',
    'nvidia/Nemotron-3_5-Lightning',
    'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
  ]) assert.throws(() => selectRepairModel([{id}]), /NO_APPROVED_LIVE_NVIDIA_NEMOTRON_MODEL/);
});

test('repair selector rejects an unsupported catalog', () => {
  assert.throws(() => selectRepairModel([{id: 'vendor/general-model', owned_by: 'system'}]),
    /NO_APPROVED_LIVE_NVIDIA_NEMOTRON_MODEL/);
});

test('repair selector requires the exact approved model in the NVIDIA catalog', () => {
  const catalog = [
    {id: 'nvidia/Nemotron-3_5-Lightning'},
    {id: 'vendor/general-model', owned_by: 'system'},
  ];
  assert.deepEqual(selectNvidiaModels(catalog).map((model) => model.id), ['nvidia/Nemotron-3_5-Lightning']);
  assert.throws(() => selectRepairModel(catalog), /NO_APPROVED_LIVE_NVIDIA_NEMOTRON_MODEL/);
});

test('repair selector rejects a Nemotron model outside the NVIDIA namespace', () => {
  assert.throws(() => selectRepairModel([{id: 'vendor/Nemotron-3-Super-120B-A12B'}]),
    /NO_APPROVED_LIVE_NVIDIA_NEMOTRON_MODEL/);
});

test('repair selector rejects catalogs without the exact approved model', () => {
  assert.throws(() => selectRepairModel([
    {id: 'vendor/Nemotron-3-Super-120B-A12B'},
    {id: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B'},
  ]), /NO_APPROVED_LIVE_NVIDIA_NEMOTRON_MODEL/);
});

test('repair selector rejects a non-NVIDIA ID even when owned_by is nvidia', () => {
  assert.throws(() => selectRepairModel([{id: 'thirdparty/foo', owned_by: 'nvidia'}]),
    /NO_APPROVED_LIVE_NVIDIA_NEMOTRON_MODEL/);
});

test('repair selector rejects a non-NVIDIA ID with NVIDIA or Nemotron in its name', () => {
  assert.throws(() => selectRepairModel([{id: 'thirdparty/foo', name: 'NVIDIA Nemotron'}]),
    /NO_APPROVED_LIVE_NVIDIA_NEMOTRON_MODEL/);
});

test('provider discovery rejects malformed account model data', () => {
  assert.throws(() => parseTokenFactoryModels({data: [{id: 'valid'}, {id: ''}]}), /malformed model/);
  assert.throws(() => parseTokenFactoryModels({data: [{id: 'valid', owned_by: 42}]}), /malformed model/);
});

test('typed Token Factory network errors preserve their safe code', () => {
  assert.equal(resolveTokenFactoryFailureCode(new TokenFactoryError(
    'TOKEN_FACTORY_NETWORK_ERROR', 'Token Factory network request failed')),
  'TOKEN_FACTORY_NETWORK_ERROR');
});

test('network failure diagnostics expose only revalidated allowlisted fields', () => {
  const diagnostic = getTokenFactoryFailureDiagnostic(new TokenFactoryError('TOKEN_FACTORY_NETWORK_ERROR', 'raw failure', {
    errorName: 'TypeError', errorMessage: 'raw failure', causeName: 'Error', causeCode: 'ETIMEDOUT',
    causeErrno: null, causeSyscall: 'connect', causeHostname: 'api.tokenfactory.us-central1.nebius.com',
    causeAddress: null, causePort: 443, raw: 'excluded',
  }));
  assert.deepEqual(diagnostic, {
    code: 'TOKEN_FACTORY_NETWORK_ERROR', errorName: 'TypeError', errorMessage: 'Token Factory network request failed',
    causeName: 'Error', causeCode: 'ETIMEDOUT', causeErrno: null, causeSyscall: 'connect',
    causeHostname: 'api.tokenfactory.us-central1.nebius.com', causeAddress: null, causePort: 443,
  });
});

for (const causeCode of ['ENOTFOUND', 'EAI_AGAIN', 'ABORT_ERR', 'UND_ERR_CONNECT_TIMEOUT']) {
  test(`network failure diagnostic preserves allowlisted ${causeCode}`, () => {
    const diagnostic = getTokenFactoryFailureDiagnostic(new TokenFactoryError('TOKEN_FACTORY_NETWORK_ERROR', 'safe', {causeCode}));
    assert.equal(diagnostic?.causeCode, causeCode);
  });
}

test('network failure diagnostics fail closed for unknown cause codes, hosts, and ports', () => {
  const diagnostic = getTokenFactoryFailureDiagnostic(new TokenFactoryError('TOKEN_FACTORY_NETWORK_ERROR', 'safe', {
    causeCode: 'PRIVATE_CAUSE', causeHostname: 'attacker.example', causePort: 8443,
  }));
  assert.equal(diagnostic?.causeCode, null);
  assert.equal(diagnostic?.causeHostname, null);
  assert.equal(diagnostic?.causePort, null);
});

test('plain objects cannot spoof network failure diagnostics', () => {
  assert.equal(getTokenFactoryFailureDiagnostic({code: 'TOKEN_FACTORY_NETWORK_ERROR', details: {causeCode: 'ETIMEDOUT'}}), null);
});

test('network failure diagnostics exclude raw stacks, authorization, keys, and request or response bodies', () => {
  const diagnostic = getTokenFactoryFailureDiagnostic(new TokenFactoryError(
    'TOKEN_FACTORY_NETWORK_ERROR', 'Authorization: Bearer synthetic-token', {
      causeCode: 'ETIMEDOUT', stack: 'synthetic raw stack', authorization: 'Bearer synthetic-token',
      apiKey: 'synthetic-api-key', requestBody: 'synthetic request body', responseBody: 'synthetic response body',
    },
  ));
  const serialized = JSON.stringify(diagnostic);
  for (const unsafe of ['Authorization', 'synthetic-token', 'synthetic-api-key', 'synthetic raw stack', 'synthetic request body', 'synthetic response body']) {
    assert.equal(serialized.includes(unsafe), false);
  }
});

test('typed Token Factory auth errors preserve their safe code', () => {
  assert.equal(resolveTokenFactoryFailureCode(new TokenFactoryError('TOKEN_FACTORY_AUTH_ERROR', 'human readable message')),
    'TOKEN_FACTORY_AUTH_ERROR');
});

test('generic uppercase errors retain the legacy safe code', () => {
  assert.equal(resolveTokenFactoryFailureCode(new Error('NO_APPROVED_LIVE_NVIDIA_NEMOTRON_MODEL')),
    'NO_APPROVED_LIVE_NVIDIA_NEMOTRON_MODEL');
});

test('generic human-readable errors fail closed', () => {
  assert.equal(resolveTokenFactoryFailureCode(new Error('Something unexpected happened')), 'UNEXPECTED_FAILURE');
});

test('plain objects cannot spoof a typed provider code', () => {
  assert.equal(resolveTokenFactoryFailureCode({code: 'TOKEN_FACTORY_AUTH_ERROR', message: 'whatever'}), 'UNEXPECTED_FAILURE');
});

test('invalid typed codes fail closed unless the message independently qualifies', () => {
  assert.equal(resolveTokenFactoryFailureCode(new TokenFactoryError('TOKEN FACTORY BAD', 'human readable message')),
    'UNEXPECTED_FAILURE');
  assert.equal(resolveTokenFactoryFailureCode(new TokenFactoryError('TOKEN FACTORY BAD', 'LEGACY_SAFE_ERROR')),
    'LEGACY_SAFE_ERROR');
});

test('typed codes exclude secret-bearing provider messages', () => {
  const fakePrivateText = 'Bearer synthetic-test-token api-key-sentinel arbitrary provider text';
  assert.equal(resolveTokenFactoryFailureCode(new TokenFactoryError('TOKEN_FACTORY_AUTH_ERROR', fakePrivateText)),
    'TOKEN_FACTORY_AUTH_ERROR');
});

const smokeModel = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';

test('endpoint E1 uses the global Token Factory default', () => {
  assert.equal(resolveTokenFactoryBaseUrl().toString(), 'https://api.tokenfactory.nebius.com/v1/');
});

test('endpoint E2 accepts the exact regional URL and preserves its diagnostic hostname', () => {
  assert.equal(resolveTokenFactoryBaseUrl('https://api.tokenfactory.us-central1.nebius.com/v1/').toString(),
    'https://api.tokenfactory.us-central1.nebius.com/v1/');
  const error = tokenFactoryNetworkError(new TypeError('fetch failed', {cause: Object.assign(new Error('lookup'), {
    code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname: 'api.tokenfactory.us-central1.nebius.com',
  })}));
  assert.ok(formatTokenFactoryNetworkDiagnostic(error)?.includes('CAT_PREFLIGHT_CAUSE_HOSTNAME=api.tokenfactory.us-central1.nebius.com'));
});

test('endpoint E3 canonicalizes the regional URL without its trailing slash', () => {
  assert.equal(resolveTokenFactoryBaseUrl('https://api.tokenfactory.us-central1.nebius.com/v1').toString(),
    'https://api.tokenfactory.us-central1.nebius.com/v1/');
});

const invalidTokenFactoryEndpoints = [
  ['E4 rejects HTTP', 'http://api.tokenfactory.us-central1.nebius.com/v1/'],
  ['E5 rejects a hostname lookalike', 'https://api.tokenfactory.us-central1.nebius.com.attacker.example/v1/'],
  ['E6 rejects an arbitrary Nebius-looking hostname', 'https://api.tokenfactory.eu.nebius.com/v1/'],
  ['E7 rejects an IP literal', 'https://203.0.113.10/v1/'],
  ['E8 rejects credentials in the URL', 'https://user:pass@api.tokenfactory.nebius.com/v1/'],
  ['E9 rejects a query string', 'https://api.tokenfactory.nebius.com/v1/?key=sentinel'],
  ['E10 rejects a fragment', 'https://api.tokenfactory.nebius.com/v1/#fragment'],
  ['E11 rejects an alternate port', 'https://api.tokenfactory.nebius.com:8443/v1/'],
  ['E12 rejects an unexpected path', 'https://api.tokenfactory.nebius.com/v2/'],
] as const;

for (const [name, value] of invalidTokenFactoryEndpoints) {
  test(`endpoint ${name}`, () => {
    assert.throws(() => resolveTokenFactoryBaseUrl(value), (error: unknown) =>
      error instanceof TokenFactoryError && error.code === 'TOKEN_FACTORY_ENDPOINT_INVALID');
  });
}

test('provider discovery uses the explicitly resolved regional endpoint and smoke requires authorization before fetch', async () => {
  const baseUrl = resolveTokenFactoryBaseUrl('https://api.tokenfactory.us-central1.nebius.com/v1/');
  const requested: string[] = [];
  const redirects: RequestRedirect[] = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    requested.push(String(input));
    redirects.push(init?.redirect as RequestRedirect);
    return requested.length === 1
      ? new Response(JSON.stringify({data: [{id: smokeModel}]}), {status: 200})
      : new Response(JSON.stringify(validSmokeResponse()), {status: 200, headers: {'content-type': 'application/json'}});
  };
  const discovery = await listTokenFactoryModels('test-key', {baseUrl, fetchImplementation});
  await assert.rejects(runTokenFactorySmoke('test-key', discovery.models[0].id, {baseUrl, fetchImplementation}), /INFERENCE_AUTHORIZATION_REQUIRED/);
  assert.deepEqual(requested, ['https://api.tokenfactory.us-central1.nebius.com/v1/models?verbose=true']);
  assert.deepEqual(redirects, ['error']);
});

test('both inference POST entry points reject absent authorization before calling fetch', async () => {
  let attempts = 0;
  const fetchImplementation: typeof fetch = async () => { attempts++; return new Response(JSON.stringify(validSmokeResponse())); };
  await assert.rejects(runTokenFactorySmoke('test-key', smokeModel, {fetchImplementation}), /INFERENCE_AUTHORIZATION_REQUIRED/);
  await assert.rejects(runTokenFactoryJsonSchemaRequest('test-key', smokeModel, 'safe prompt', {type: 'object'}, {fetchImplementation}), /INFERENCE_AUTHORIZATION_REQUIRED/);
  assert.equal(attempts, 0);
});

test('both inference POST paths reject a locally forged owner approval before fetch', async () => {
  const fixture = authorizationFixture(authorizationRequest);
  let attempts = 0;
  const fetchImplementation: typeof fetch = async () => { attempts++; return new Response('{}'); };
  const options = {fetchImplementation, authorizationFile: fixture.authorizationFile,
    operationId: authorizationRequest.operationId, accountReference: authorizationRequest.accountReference};
  try {
    await assert.rejects(runTokenFactorySmoke('test-key', smokeModel, options), /INFERENCE_AUTHENTICATED_OWNER_APPROVAL_UNAVAILABLE/);
    await assert.rejects(runTokenFactoryJsonSchemaRequest('test-key', smokeModel, 'safe prompt', {type: 'object'}, options), /INFERENCE_AUTHENTICATED_OWNER_APPROVAL_UNAVAILABLE/);
    assert.equal(attempts, 0);
  } finally { fixture.cleanup(); }
});

test('provider operations reject an unapproved injected base URL before fetch', async () => {
  let attempts = 0;
  await assert.rejects(listTokenFactoryModels('test-key', {
    baseUrl: new URL('https://attacker.example/v1/'),
    fetchImplementation: async () => { attempts++; return new Response('{}'); },
  }), (error: unknown) => error instanceof TokenFactoryError && error.code === 'TOKEN_FACTORY_ENDPOINT_INVALID');
  assert.equal(attempts, 0);
});

function dnsFailure(code: string) {
  return new TypeError('fetch failed', {cause: Object.assign(new Error('private raw failure'), {
    code, errno: -3008, syscall: 'getaddrinfo', hostname: 'api.tokenfactory.nebius.com',
  })});
}

test('Token Factory GET recovers once from ENOTFOUND and exposes only safe metadata', async () => {
  let attempts = 0;
  const recovered = await listTokenFactoryModels('test-key', {
    fetchImplementation: async () => {
      attempts++;
      if (attempts === 1) throw dnsFailure('ENOTFOUND');
      return new Response(JSON.stringify({data: [{id: smokeModel}]}), {status: 200});
    },
  });
  assert.equal(attempts, 2);
  assert.equal(recovered.networkAttempts, 2);
  assert.equal(recovered.recoveredNetworkCause, 'ENOTFOUND');
  assert.equal(JSON.stringify(recovered).includes('private raw failure'), false);
  assert.equal(JSON.stringify(recovered).includes('Authorization'), false);
});

test('Token Factory DNS retry recovers EAI_AGAIN', async () => {
  let attempts = 0;
  const recovered = await listTokenFactoryModels('test-key', {
    fetchImplementation: async () => {
      attempts++;
      if (attempts === 1) throw dnsFailure('EAI_AGAIN');
      return new Response(JSON.stringify({data: [{id: smokeModel}]}), {status: 200});
    },
  });
  assert.equal(attempts, 2);
  assert.equal(recovered.networkAttempts, 2);
  assert.equal(recovered.recoveredNetworkCause, 'EAI_AGAIN');
});

test('Token Factory retry metadata excludes headers, credentials, and raw exceptions', async () => {
  let attempts = 0;
  const result = await listTokenFactoryModels('api-key-sentinel', {
    fetchImplementation: async () => {
      attempts++;
      if (attempts === 1) throw dnsFailure('ENOTFOUND');
      return new Response(JSON.stringify({data: [{id: smokeModel}]}), {status: 200});
    },
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.networkAttempts, 2);
  assert.equal(result.recoveredNetworkCause, 'ENOTFOUND');
  for (const unsafe of ['headers', 'Authorization', 'api-key-sentinel', 'private raw failure']) {
    assert.equal(serialized.includes(unsafe), false);
  }
});

test('Token Factory DNS retry stops after exactly two ENOTFOUND attempts', async () => {
  let attempts = 0;
  await assert.rejects(listTokenFactoryModels('test-key', {
    fetchImplementation: async () => { attempts++; throw dnsFailure('ENOTFOUND'); },
  }), (error: unknown) => error instanceof TokenFactoryError && error.code === 'TOKEN_FACTORY_NETWORK_ERROR' && error.details.causeCode === 'ENOTFOUND');
  assert.equal(attempts, 2);
});

for (const cause of ['ECONNRESET', 'ETIMEDOUT']) {
  test(`smoke authorization is required before a ${cause} can reach the network`, async () => {
    let attempts = 0;
    await assert.rejects(runTokenFactorySmoke('test-key', smokeModel, {
      fetchImplementation: async () => { attempts++; throw dnsFailure(cause); },
    }), /INFERENCE_AUTHORIZATION_REQUIRED/);
    assert.equal(attempts, 0);
  });
}

for (const status of [429, 500]) {
  test(`smoke authorization is required before HTTP ${status} can reach the network`, async () => {
    let attempts = 0;
    await assert.rejects(runTokenFactorySmoke('test-key', smokeModel, {
      fetchImplementation: async () => { attempts++; return new Response('', {status}); },
    }), /INFERENCE_AUTHORIZATION_REQUIRED/);
    assert.equal(attempts, 0);
  });
}

test('Token Factory does not call fetch or retry when the controlling signal is aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  let attempts = 0;
  await assert.rejects(listTokenFactoryModels('test-key', {
    signal: controller.signal,
    fetchImplementation: async () => { attempts++; return new Response('{}'); },
  }), (error: unknown) => error instanceof TokenFactoryError && error.details.causeCode === 'ABORT_ERR');
  assert.equal(attempts, 0);
});

test('Token Factory discovery receives a timeout signal and unauthorized inference is stopped before fetch', async () => {
  const signals: AbortSignal[] = [];
  const fetchImplementation: typeof fetch = async (_input, init) => {
    signals.push(init?.signal as AbortSignal);
    return signals.length === 1
      ? new Response(JSON.stringify({data: [{id: smokeModel}]}), {status: 200})
      : new Response(JSON.stringify(validSmokeResponse()), {status: 200, headers: {'content-type': 'application/json'}});
  };
  await listTokenFactoryModels('test-key', {timeoutMs: 1000, fetchImplementation});
  await assert.rejects(runTokenFactorySmoke('test-key', smokeModel, {timeoutMs: 1000, fetchImplementation}), /INFERENCE_AUTHORIZATION_REQUIRED/);
  assert.equal(signals.length, 1);
  assert.ok(signals[0] instanceof AbortSignal);
});

test('a simulated AbortError is typed as a network failure with a safe cause code', async () => {
  let attempts = 0;
  await assert.rejects(runTokenFactorySmoke('test-key', smokeModel, {
    fetchImplementation: async () => {
      attempts++;
      throw new TypeError('fetch failed', {cause: Object.assign(new Error('synthetic abort'), {name: 'AbortError', code: 'ABORT_ERR'})});
    },
  }), /INFERENCE_AUTHORIZATION_REQUIRED/);
  assert.equal(attempts, 0);
});

test('Token Factory discovery retains its 15000 ms default; inference needs an explicit authorization', async () => {
  const durations: number[] = [];
  const original = AbortSignal.timeout;
  AbortSignal.timeout = ((milliseconds: number) => {
    durations.push(milliseconds);
    return original.call(AbortSignal, milliseconds);
  }) as typeof AbortSignal.timeout;
  try {
    const fetchImplementation: typeof fetch = async () => new Response(JSON.stringify({data: [{id: smokeModel}]}), {status: 200});
    await listTokenFactoryModels('test-key', {fetchImplementation});
    await assert.rejects(runTokenFactorySmoke('test-key', smokeModel, {fetchImplementation}), /INFERENCE_AUTHORIZATION_REQUIRED/);
    await assert.rejects(runTokenFactoryJsonSchemaRequest('test-key', smokeModel, 'test request', {type: 'object'}, {fetchImplementation}), /INFERENCE_AUTHORIZATION_REQUIRED/);
    assert.deepEqual(durations, [15000]);
  } finally {
    AbortSignal.timeout = original;
  }
});

test('Token Factory refuses redirects for discovery and blocks inference without authorization', async () => {
  const observed: RequestRedirect[] = [];
  const fetchImplementation: typeof fetch = async (_input, init) => {
    observed.push(init?.redirect as RequestRedirect);
    return observed.length === 1
      ? new Response(JSON.stringify({data: [{id: smokeModel}]}), {status: 200})
      : new Response(JSON.stringify(validSmokeResponse()), {status: 200, headers: {'content-type': 'application/json'}});
  };
  await listTokenFactoryModels('test-key', {fetchImplementation});
  await assert.rejects(runTokenFactorySmoke('test-key', smokeModel, {fetchImplementation}), /INFERENCE_AUTHORIZATION_REQUIRED/);
  assert.deepEqual(observed, ['error']);
});

test('repair POST validation cannot be reached without one-use authorization', async () => {
  const call = (message: Record<string, unknown>, finish_reason: string) => runTokenFactoryJsonSchemaRequest('test-key', smokeModel, 'safe prompt', {type: 'object'}, {
    fetchImplementation: async () => new Response(JSON.stringify({id: 'id', model: smokeModel, choices: [{finish_reason, message}]}), {status: 200}),
  });
  await assert.rejects(call({content: null, refusal: 'No'}, 'length'), /INFERENCE_AUTHORIZATION_REQUIRED/);
  await assert.rejects(call({content: '{'}, 'length'), /INFERENCE_AUTHORIZATION_REQUIRED/);
});

test('observation request body is bounded and does not provide a POST route', () => {
  const schema = {type: 'object', additionalProperties: false};
  const body = JSON.parse(buildTokenFactoryObservationBody('nvidia/nemotron-3-super-120b-a12b', 'safe bounded prompt', schema));
  assert.equal(body.max_tokens, 192);
  assert.equal(body.response_format.json_schema.name, 'cat_oracle_observation_proposal');
  assert.throws(() => buildTokenFactoryObservationBody('nvidia/other-model', 'safe prompt', schema), /TOKEN_FACTORY_OBSERVATION_REQUEST_INVALID/);
});

function validSmokeResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    object: 'chat.completion',
    model: smokeModel,
    choices: [{index: 0, finish_reason: 'stop', message: {role: 'assistant', content: 'OK'}}],
    usage: {prompt_tokens: 8, completion_tokens: 1, total_tokens: 9},
    ...overrides,
  };
}

test('provider smoke accepts a documented chat completion and captures usage', () => {
  assert.deepEqual(parseTokenFactorySmokeResponse(validSmokeResponse(), smokeModel), {
    requestId: 'request-1', responseModel: smokeModel, finishReason: 'stop', outputBytes: 2,
    contentType: 'string', reasoningPresent: 'no', reasoningType: 'absent',
    outcome: 'content', tokenUsage: {prompt: 8, completion: 1, total: 9},
  });
});

test('provider smoke rejects a missing choices field as a schema error', () => {
  const {choices: _choices, ...missing} = validSmokeResponse();
  assert.throws(() => parseTokenFactorySmokeResponse(missing, smokeModel),
    (error: unknown) => error instanceof TokenFactoryError && error.code === 'TOKEN_FACTORY_RESPONSE_SCHEMA_ERROR');
});

test('provider smoke rejects empty choices as a schema error', () => {
  assert.throws(() => parseTokenFactorySmokeResponse(validSmokeResponse({choices: []}), smokeModel),
    (error: unknown) => error instanceof TokenFactoryError && error.code === 'TOKEN_FACTORY_RESPONSE_SCHEMA_ERROR');
});

test('provider smoke rejects a missing message as a schema error', () => {
  assert.throws(() => parseTokenFactorySmokeResponse(validSmokeResponse({choices: [{finish_reason: 'stop'}]}), smokeModel),
    (error: unknown) => error instanceof TokenFactoryError && error.code === 'TOKEN_FACTORY_RESPONSE_SCHEMA_ERROR');
});

test('provider HTTP 401 is a typed auth error', async () => {
  const error = await tokenFactoryHttpError(new Response(JSON.stringify({error: {
    type: 'authentication_error', code: 'invalid_api_key', message: 'Bearer hidden-value',
  }}), {status: 401, headers: {'content-type': 'application/json', 'x-request-id': 'request-401'}}), 'hidden-value');
  assert.equal(error.code, 'TOKEN_FACTORY_AUTH_ERROR');
  assert.equal(error.details.status, 401);
  assert.equal(error.details.providerErrorType, 'authentication_error');
  assert.equal(error.details.providerErrorCode, 'invalid_api_key');
  assert.equal(error.details.providerMessage, 'Bearer [REDACTED]');
  assert.equal(error.details.requestId, 'request-401');
});

test('provider HTTP 429 is a typed rate-limit error', async () => {
  const error = await tokenFactoryHttpError(new Response('', {status: 429, headers: {'retry-after': '1'}}));
  assert.equal(error.code, 'TOKEN_FACTORY_RATE_LIMIT');
  assert.equal(error.details.status, 429);
  assert.equal(error.details.retryAfter, '1');
});

test('provider network diagnostics capture ENOTFOUND without secret-bearing headers', () => {
  const error = tokenFactoryNetworkError(new TypeError('fetch failed', {cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), {
    code: 'ENOTFOUND', errno: -3008, syscall: 'getaddrinfo', hostname: 'api.tokenfactory.nebius.com',
  })}));
  assert.equal(error.code, 'TOKEN_FACTORY_NETWORK_ERROR');
  assert.equal(error.details.causeCode, 'ENOTFOUND');
  const diagnostic = formatTokenFactoryNetworkDiagnostic(error);
  assert.ok(diagnostic?.includes('CAT_PREFLIGHT_ERROR=TOKEN_FACTORY_NETWORK_ERROR'));
  assert.ok(diagnostic?.includes('CAT_PREFLIGHT_CAUSE_CODE=ENOTFOUND'));
  const serialized = JSON.stringify(diagnostic);
  assert.ok(!serialized.includes('Authorization'));
  assert.ok(!serialized.includes('test-api-key'));
});

test('provider network diagnostics capture ECONNRESET', () => {
  const error = tokenFactoryNetworkError(new TypeError('fetch failed', {cause: Object.assign(new Error('socket hang up'), {
    code: 'ECONNRESET', syscall: 'read', address: '203.0.113.1', port: 443,
  })}));
  assert.equal(error.code, 'TOKEN_FACTORY_NETWORK_ERROR');
  assert.equal(error.details.causeCode, 'ECONNRESET');
  assert.equal(error.details.causeSyscall, 'read');
  assert.ok(formatTokenFactoryNetworkDiagnostic(error)?.includes('CAT_PREFLIGHT_CAUSE_CODE=ECONNRESET'));
});

test('provider network diagnostics classify missing cause metadata as UNKNOWN', () => {
  const error = tokenFactoryNetworkError(new TypeError('fetch failed'));
  assert.equal(error.code, 'TOKEN_FACTORY_NETWORK_ERROR');
  assert.equal(error.details.causeCode, 'UNKNOWN');
  assert.ok(formatTokenFactoryNetworkDiagnostic(error)?.includes('CAT_PREFLIGHT_CAUSE_CODE=UNKNOWN'));
});

test('provider network diagnostic serialization excludes secret-bearing error properties', () => {
  const error = Object.assign(new TypeError('fetch failed'), {
    Authorization: 'Bearer secret-sentinel-12345',
    headers: {Authorization: 'Bearer secret-sentinel-12345'},
    apiKey: 'secret-sentinel-12345',
    cause: Object.assign(new Error('socket failure'), {code: 'ECONNRESET', headers: {Authorization: 'Bearer secret-sentinel-12345'}}),
  });
  const serialized = JSON.stringify(formatTokenFactoryNetworkDiagnostic(tokenFactoryNetworkError(error)));
  for (const value of ['Authorization', 'headers', 'apiKey', 'secret-sentinel-12345']) assert.ok(!serialized.includes(value));
});

test('provider network formatter rejects unsafe values even from a forged typed error', () => {
  const error = new TokenFactoryError('TOKEN_FACTORY_NETWORK_ERROR', 'Authorization: Basic outer-secret', {
    errorName: 'TypeError', errorMessage: 'Authorization: Basic dXNlcjpwYXNz', causeName: 'Error', causeCode: 'ENOTFOUND',
    causeHostname: 'sentinel-host-secret', causeAddress: 'not-an-ip', causePort: 8443, causeErrno: '9999999999', causeSyscall: 'sentinel-call',
    Authorization: 'Bearer secret-sentinel-12345', headers: 'secret-sentinel-12345', apiKey: 'secret-sentinel-12345',
    requestBody: 'body-sentinel', requestUrl: 'https://host.invalid/path?apiKey=query-sentinel',
    environment: 'env-sentinel', stack: 'stack-sentinel\r\nsecret-sentinel',
  });
  const preflight = formatTokenFactoryNetworkDiagnostic(error) ?? [];
  const smoke = formatTokenFactoryNetworkDiagnostic(error, 'CAT_SMOKE') ?? [];
  const serialized = JSON.stringify([preflight, smoke]);
  for (const value of ['outer-secret', 'dXNlcjpwYXNz', 'sentinel-host-secret', 'not-an-ip', 'sentinel-call', 'Authorization', 'headers', 'apiKey', 'secret-sentinel-12345', 'body-sentinel', 'query-sentinel', 'env-sentinel', 'stack-sentinel']) {
    assert.ok(!serialized.includes(value));
  }
  assert.ok(preflight.includes('CAT_PREFLIGHT_ERROR_MESSAGE=Token Factory network request failed'));
  assert.ok(preflight.includes('CAT_PREFLIGHT_CAUSE_HOSTNAME=UNKNOWN'));
  assert.ok(preflight.includes('CAT_PREFLIGHT_CAUSE_ADDRESS=UNKNOWN'));
  assert.ok(preflight.includes('CAT_PREFLIGHT_CAUSE_PORT=UNKNOWN'));
  assert.ok(preflight.includes('CAT_PREFLIGHT_CAUSE_ERRNO=UNKNOWN'));
  assert.ok(preflight.includes('CAT_PREFLIGHT_CAUSE_SYSCALL=UNKNOWN'));
  assert.ok(smoke.includes('CAT_SMOKE_ERROR=TOKEN_FACTORY_NETWORK_ERROR'));
  assert.ok(smoke.includes('CAT_SMOKE_ERROR_MESSAGE=Token Factory network request failed'));
  assert.ok(smoke.includes('CAT_SMOKE_CAUSE_ERRNO=UNKNOWN'));
});

test('provider network formatter bounds and canonicalizes string errno values', () => {
  const inRange = new TokenFactoryError('TOKEN_FACTORY_NETWORK_ERROR', 'safe', {causeErrno: '-3008'});
  const outOfRange = new TokenFactoryError('TOKEN_FACTORY_NETWORK_ERROR', 'safe', {causeErrno: '2147483648'});
  assert.ok(formatTokenFactoryNetworkDiagnostic(inRange)?.includes('CAT_PREFLIGHT_CAUSE_ERRNO=-3008'));
  assert.ok(formatTokenFactoryNetworkDiagnostic(inRange, 'CAT_SMOKE')?.includes('CAT_SMOKE_CAUSE_ERRNO=-3008'));
  assert.ok(formatTokenFactoryNetworkDiagnostic(outOfRange)?.includes('CAT_PREFLIGHT_CAUSE_ERRNO=UNKNOWN'));
  assert.ok(formatTokenFactoryNetworkDiagnostic(outOfRange, 'CAT_SMOKE')?.includes('CAT_SMOKE_CAUSE_ERRNO=UNKNOWN'));
});

test('successful non-JSON provider response retains status, size, and digest as a parse error', async () => {
  await assert.rejects(readJsonBounded(new Response('<html>unavailable</html>', {
    status: 200,
    headers: {'content-type': 'text/html'},
  })), (error: unknown) => error instanceof TokenFactoryError &&
    error.code === 'TOKEN_FACTORY_RESPONSE_NOT_JSON' && error.details.status === 200 &&
    error.details.contentType === 'text/html' && error.details.responseBytes === 24 &&
    typeof error.details.responseSha256 === 'string');
});

test('provider refusal is a typed outcome, not a schema error', () => {
  const result = parseTokenFactorySmokeResponse(validSmokeResponse({
    choices: [{finish_reason: 'stop', message: {role: 'assistant', content: null, refusal: 'unsupported'}}],
  }), smokeModel);
  assert.equal(result.outcome, 'refusal');
  assert.equal(result.outputBytes, 0);
});

test('provider refusal remains distinct when finish reason is length', () => {
  const result = parseTokenFactorySmokeResponse(validSmokeResponse({
    choices: [{finish_reason: 'length', message: {role: 'assistant', content: 'partial answer', refusal: 'unsupported'}}],
  }), smokeModel);
  assert.equal(result.outcome, 'refusal');
  assert.equal(result.outputBytes, 0);
});

test('provider smoke handles the observed richer NVIDIA message when content is usable', () => {
  const result = parseTokenFactorySmokeResponse(validSmokeResponse({
    choices: [{finish_reason: 'stop', message: {
      role: 'assistant', content: 'OK', refusal: null, reasoning: 'synthetic omitted reasoning',
      annotations: null, audio: null, function_call: null, tool_calls: null,
    }}],
  }), smokeModel);
  assert.equal(result.outcome, 'content');
  assert.equal(result.outputBytes, 2);
  assert.equal(result.reasoningPresent, 'yes');
  assert.equal(result.reasoningType, 'string');
});

test('provider smoke distinguishes a length-truncated response from malformed schema', () => {
  assert.throws(() => parseTokenFactorySmokeResponse(validSmokeResponse({
    choices: [{finish_reason: 'length', message: {role: 'assistant', content: null, refusal: null, reasoning: 'synthetic omitted reasoning'}}],
  }), smokeModel), (error: unknown) => error instanceof TokenFactoryError &&
    error.code === 'TOKEN_FACTORY_OUTPUT_INCOMPLETE' && error.details.finishReason === 'length' &&
    error.details.contentType === 'null' && error.details.reasoningPresent === 'yes' &&
    error.details.reasoningType === 'string' && error.details.completionTokens === 1);
});

test('provider smoke classifies an empty length-truncated response as incomplete', () => {
  assert.throws(() => parseTokenFactorySmokeResponse(validSmokeResponse({
    choices: [{finish_reason: 'length', message: {role: 'assistant', content: ''}}],
  }), smokeModel), (error: unknown) => error instanceof TokenFactoryError && error.code === 'TOKEN_FACTORY_OUTPUT_INCOMPLETE');
});

test('provider smoke classifies nonempty length-truncated content as incomplete', () => {
  assert.throws(() => parseTokenFactorySmokeResponse(validSmokeResponse({
    choices: [{finish_reason: 'length', message: {role: 'assistant', content: 'partial answer'}}],
  }), smokeModel), (error: unknown) => error instanceof TokenFactoryError && error.code === 'TOKEN_FACTORY_OUTPUT_INCOMPLETE' &&
    error.details.finishReason === 'length' && error.details.outputBytes === Buffer.byteLength('partial answer'));
});

test('provider smoke rejects undocumented finish reasons instead of accepting content', () => {
  assert.throws(() => parseTokenFactorySmokeResponse(validSmokeResponse({
    choices: [{finish_reason: 'content_filter', message: {role: 'assistant', content: 'OK'}}],
  }), smokeModel), (error: unknown) => error instanceof TokenFactoryError &&
    error.code === 'TOKEN_FACTORY_FINISH_REASON_UNSUPPORTED' && error.details.finishReason === 'content_filter');
});
