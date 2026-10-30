import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {buildRejectedHeroPublicEvidence, formatPublicEvidenceSummary, serializePublicEvidenceV1, validatePublicEvidenceV1} from '../src/evidence/public-evidence-v1.ts';

const source = {candidateHash: '143ccb56526e031511a693f2be5d01d1c4ceac915195835c7703b8f4e244b43c', operationId: null, executionBackend: 'LOCAL_DOCKER_FALLBACK' as const, sandboxStatus: 'CLIENT_UNAVAILABLE' as const};
const hero = buildRejectedHeroPublicEvidence(source);
const clone = () => structuredClone(hero) as typeof hero;
const reject = (fn: () => void) => assert.throws(fn, /PUBLIC_EVIDENCE_V1_INVALID/);

test('DP02F public fixture validates and matches deterministic serialization', () => {
  const bytes = readFileSync(new URL('../fixtures/public-evidence/node-cache-ttl-zero-001.rejected.json', import.meta.url), 'utf8');
  const parsed = JSON.parse(bytes);
  validatePublicEvidenceV1(parsed);
  assert.equal(bytes.replace(/\r\n/g, '\n'), serializePublicEvidenceV1(hero));
  assert.equal(createHash('sha256').update(bytes).digest('hex').length, 64);
});

test('synthetic ACCEPTED evidence requires frozen candidate and hidden pass', () => {
  const value = clone();
  value.case.synthetic = true; value.case.title = 'SYNTHETIC_TEST_ONLY accepted contract';
  value.decision.decision = 'ACCEPTED'; value.decision.candidateAccepted = true; value.decision.reasonCodes = [];
  value.decision.summary = 'SYNTHETIC_TEST_ONLY candidate passed all public and hidden checks.';
  value.authority.authorityStatus = 'CONFIRMED';
  value.authority.observedBehavior = value.authority.expectedBehavior;
  value.candidate.frozen = true; value.candidate.frozenCandidateHash = value.candidate.candidateHash;
  value.hiddenVerification = {state: 'PASS', challengeCount: 1, blindResult: 'PASS', explanation: 'BLIND_VERIFICATION_COMPLETED'};
  value.gates.forEach((gate) => {gate.result = 'PASS'; gate.failureKind = 'NONE'; gate.reasonCode = null;});
  validatePublicEvidenceV1(value);
});

test('synthetic HUMAN_REQUIRED evidence supports ambiguous authority without inference', () => {
  const value = clone();
  value.case.synthetic = true; value.case.title = 'SYNTHETIC_TEST_ONLY human review contract';
  value.decision.decision = 'HUMAN_REQUIRED'; value.decision.candidateAccepted = false; value.decision.reasonCodes = [];
  value.authority.authorityStatus = 'AMBIGUOUS';
  value.hiddenVerification = {state: 'NOT_APPLICABLE', challengeCount: 0, blindResult: 'NOT_RUN', explanation: 'NOT_APPLICABLE'};
  value.inference = {provider: null, model: null, requestId: null, operationId: null, finishReason: null, networkAttempts: 0, proven: false};
  validatePublicEvidenceV1(value);
});

test('P1-P22 reject private fields, unsafe claims, malformed bindings and paths', () => {
  const cases: Array<(v: any) => void> = [
    v => v.rawApiKey = 'x', v => v.inference.authorizationHeader = 'Bearer x', v => v.rawPrompt = 'x',
    v => v.rawModelResponse = 'x', v => v.privateHoldout = 'x', v => v.decision.summary = 'C:\\Users\\name\\secret',
    v => v.authority.observedBehavior = '/home/user/private', v => {v.decision.candidateAccepted = true;},
    v => {v.decision.decision = 'ACCEPTED'; v.decision.candidateAccepted = true;},
    v => v.gates[1].id = v.gates[0].id, v => v.candidate.candidateHash = 'bad',
    v => v.provenance.historicalRunId = 'bad', v => {v.inference.provider = null;},
    v => {v.inference.requestId = null;}, v => {v.execution.backend = 'NEBIUS_SANDBOX'; v.execution.sandboxStatus = 'AVAILABLE';},
    v => v.unknown = true, v => v.candidate.extra = 'x',
    v => v.candidate.changedPaths.push(v.candidate.changedPaths[0]), v => v.candidate.changedPaths.push('../secret'),
    v => v.candidate.changedPaths.push('.gortex/private.json'), v => v.candidate.changedPaths.push('.agent-runs/p05-s/private/x'),
    v => v.authority.observedBehavior = 'Sealed holdout challenge: private value',
  ];
  assert.equal(cases.length, 22);
  cases.forEach((mutate) => {const value = clone(); mutate(value); reject(() => validatePublicEvidenceV1(value));});
});

test('serialization sorts object keys and preserves semantically ordered arrays', () => {
  assert.equal(serializePublicEvidenceV1(hero), serializePublicEvidenceV1(clone()));
  assert.deepEqual(hero.decision.reasonCodes, ['PUBLIC_CONTRACT_FAILURE', 'PUBLIC_ORACLE_V2_FAILURE']);
});

test('provider/model and execution attribution cannot contradict each other', () => {
  const wrongModelOwner = clone(); wrongModelOwner.inference.provider = 'OpenAI';
  reject(() => validatePublicEvidenceV1(wrongModelOwner));
  const wrongBackendClaim = clone(); wrongBackendClaim.execution.backend = 'NEBIUS_SANDBOX'; wrongBackendClaim.execution.sandboxStatus = 'AVAILABLE';
  reject(() => validatePublicEvidenceV1(wrongBackendClaim));
});

test('secret-looking candidate paths fail closed', () => {
  for (const secretPath of ['secrets/api-key.txt', '.env', '.env.local', '.envrc', '.aws/credentials']) {
    const value = clone(); value.candidate.changedPaths.push(secretPath);
    reject(() => validatePublicEvidenceV1(value));
  }
});

test('local Docker backend rejects contradictory Nebius Sandbox and negated local claims', () => {
  for (const claim of [
    'Nebius Sandbox executed candidate validation; local Docker was not used.',
    'Candidate validation did not run in isolated local Docker.',
  ]) {
    const value = clone(); value.execution.providerClaim = claim;
    reject(() => validatePublicEvidenceV1(value));
  }
});

test('summary reports no inference when the validated evidence has none', () => {
  const value = clone();
  value.case.synthetic = true; value.case.title = 'SYNTHETIC_TEST_ONLY human review contract';
  value.decision.decision = 'HUMAN_REQUIRED'; value.decision.candidateAccepted = false;
  value.authority.authorityStatus = 'AMBIGUOUS';
  value.hiddenVerification = {state: 'NOT_APPLICABLE', challengeCount: 0, blindResult: 'NOT_RUN', explanation: 'NOT_APPLICABLE'};
  value.inference = {provider: null, model: null, requestId: null, operationId: null, finishReason: null, networkAttempts: 0, proven: false};
  const summary = formatPublicEvidenceSummary(value);
  assert.match(summary, /AI inference:\nNOT RUN/);
  assert.doesNotMatch(summary, /Nebius/);
});

test('CLI refuses output through a junction or symbolic link', (t) => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'cat-evidence-link-'));
  try {
    const target = path.join(temporary, 'protected'); mkdirSync(target);
    const link = path.join(temporary, 'alias');
    try { symlinkSync(target, link, 'junction'); } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code && ['EPERM', 'EACCES', 'ENOSYS'].includes(code)) { t.skip(`junction creation unavailable: ${code}`); return; }
      throw error;
    }
    assert.throws(() => execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/cat-public-evidence.ts', '--output', path.join(link, 'evidence.json')], {cwd: process.cwd(), stdio: 'pipe'}));
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
});
