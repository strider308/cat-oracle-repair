import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {
  H0_AUTHORITY_SOURCE, P04_CONTROL_SOURCE, projectH0AuthorityPreflight, projectVerifiedGoodControl,
  serializePublicAuthorityPreflightV1, serializePublicExecutedControlV1,
  validatePublicAuthorityPreflightV1, validatePublicExecutedControlV1,
} from '../src/evidence/public-case-schemas.ts';
import {DEFAULT_PUBLIC_CASE_ID, PUBLIC_CASE_REGISTRY, loadPublicDecisionCase, loadPublicFixtureCase} from '../src/evidence/public-decision-cases.ts';
import {buildRejectedHeroPublicEvidence, validatePublicEvidenceV1} from '../src/evidence/public-evidence-v1.ts';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const rejectedPath = 'fixtures/public-evidence/node-cache-ttl-zero-001.rejected.json';
const acceptedPath = 'fixtures/public-evidence/p04-good-control-001.accepted.json';
const humanPath = 'fixtures/public-evidence/h0-1-authority-preflight-001.human-required.json';
const scenarioPath = 'fixtures/public-evidence/h0-1-authority-preflight-001.scenario.json';
const source = {candidateHash: '143ccb56526e031511a693f2be5d01d1c4ceac915195835c7703b8f4e244b43c', operationId: null, executionBackend: 'LOCAL_DOCKER_FALLBACK' as const, sandboxStatus: 'CLIENT_UNAVAILABLE' as const};

test('three public case schemas validate and rejected V1 fixture bytes stay immutable', () => {
  const rejectedBytes = readFileSync(rejectedPath);
  const canonicalBytes = Buffer.from(rejectedBytes.toString('utf8').replace(/\r\n/g, '\n'));
  assert.equal(hash(canonicalBytes), 'dd9539a1663d29b01abfc0edf5f8bddf202b7830d05730a1db946e259269ce6a');
  validatePublicEvidenceV1(JSON.parse(rejectedBytes.toString('utf8')));
  validatePublicExecutedControlV1(JSON.parse(readFileSync(acceptedPath, 'utf8')));
  validatePublicAuthorityPreflightV1(JSON.parse(readFileSync(humanPath, 'utf8')));
  assert.equal(hash(Buffer.from(readFileSync(rejectedPath, 'utf8').replace(/\r\n/g, '\n'))), 'dd9539a1663d29b01abfc0edf5f8bddf202b7830d05730a1db946e259269ce6a');
});

test('rejected public evidence remains hash-bound after a Windows checkout conversion', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cat-public-evidence-crlf-'));
  try {
    const target = path.join(root, rejectedPath);
    mkdirSync(path.dirname(target), {recursive: true});
    const original = readFileSync(rejectedPath, 'utf8').replace(/\r\n/g, '\n');
    writeFileSync(target, original.replace(/\n/g, '\r\n'));
    assert.equal(loadPublicFixtureCase(DEFAULT_PUBLIC_CASE_ID, root).publicJson, original);

    writeFileSync(target, original.replace('Existing tests were green', 'Different tests were green').replace(/\n/g, '\r\n'));
    assert.throws(() => loadPublicFixtureCase(DEFAULT_PUBLIC_CASE_ID, root), /PUBLIC_CASE_FIXTURE_INTEGRITY/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('PublicEvidenceV1 rejects operational and not-run provenance contradictions', () => {
  const error = buildRejectedHeroPublicEvidence(source);
  const operational = structuredClone(error);
  operational.decision.jobStatus = 'INCONCLUSIVE';
  operational.decision.decision = null;
  operational.decision.candidateAccepted = false;
  operational.gates[0].result = 'ERROR';
  operational.gates[0].failureKind = 'OPERATIONAL';
  operational.gates[0].reasonCode = 'BUILD_ERROR';
  validatePublicEvidenceV1(operational);
  operational.decision.decision = 'REJECTED';
  operational.decision.jobStatus = 'COMPLETED';
  operational.decision.reasonCodes = ['PUBLIC_CONTRACT_FAILURE'];
  assert.throws(() => validatePublicEvidenceV1(operational), /OPERATIONAL_ERROR/);

  const notRun = structuredClone(error);
  notRun.execution.backend = 'NOT_RUN';
  notRun.execution.sandboxStatus = 'NOT_APPLICABLE';
  notRun.execution.providerClaim = 'Candidate validation ran in isolated local Docker.';
  assert.throws(() => validatePublicEvidenceV1(notRun), /NOT_RUN_PROVENANCE/);

  const fakeModel = structuredClone(error);
  fakeModel.inference.provider = null;
  fakeModel.inference.model = null;
  fakeModel.inference.requestId = null;
  fakeModel.inference.operationId = null;
  fakeModel.inference.finishReason = null;
  fakeModel.inference.proven = false;
  fakeModel.inference.networkAttempts = 1;
  assert.throws(() => validatePublicEvidenceV1(fakeModel), /NOT_RUN_PROVENANCE/);
});

test('executed-control schema rejects accepted claims without verified good-lane results', () => {
  const evidence = JSON.parse(readFileSync(acceptedPath, 'utf8'));
  for (const mutate of [
    (v: any) => {v.decision = 'REJECTED';},
    (v: any) => {v.historicalRun = 'unknown';},
    (v: any) => {v.lane.id = 's2';},
    (v: any) => {v.results.sealed = 'FAIL';},
    (v: any) => {v.aggregateRunDecision = 'ACCEPTED';},
    (v: any) => {v.sourceReceipt.fileSha256 = '0'.repeat(64);},
    (v: any) => {v.sourceReceipt.runId = 'not-a-run-id';},
    (v: any) => {v.model = 'nvidia/example';},
    (v: any) => {v.sourceReceipt.path = 'C:\\Users\\private.json';},
  ]) {
    const copy = structuredClone(evidence);
    mutate(copy);
    assert.throws(() => validatePublicExecutedControlV1(copy));
  }
});

test('authority-preflight schema fails closed on execution, provenance, and path contradictions', () => {
  const evidence = JSON.parse(readFileSync(humanPath, 'utf8'));
  for (const mutate of [
    (v: any) => {v.decision = 'ACCEPTED';},
    (v: any) => {v.candidateAccepted = true;},
    (v: any) => {v.execution = 'PASS';},
    (v: any) => {v.hiddenVerification = 'PASS';},
    (v: any) => {v.authorityStatus = 'CONFIRMED';},
    (v: any) => {v.operationalFailure = true;},
    (v: any) => {v.historicalRun = true;},
    (v: any) => {v.model = 'provider/model';},
    (v: any) => {v.provenance.authorityDocumentPath = '../private.json';},
    (v: any) => {v.provenance.scenarioDefinitionSha256 = 'bad';},
  ]) {
    const copy = structuredClone(evidence);
    mutate(copy);
    assert.throws(() => validatePublicAuthorityPreflightV1(copy));
  }
});

test('P04 historical fixture is canonical, but strict projector refuses the missing sealed annex', () => {
  const archival = loadPublicFixtureCase('p04-good-control-001');
  assert.equal(archival.publicJson, readFileSync(acceptedPath, 'utf8').replace(/\r\n/g, '\n'));
  assert.throws(() => projectVerifiedGoodControl(), /P04_CONTROL_VERIFICATION_FAILED/);
  assert.throws(() => loadPublicDecisionCase('p04-good-control-001'), /P04_CONTROL_VERIFICATION_FAILED/);
});

test('accepted projector stops when its fixed source receipt hash changes', () => {
  if (!existsSync(P04_CONTROL_SOURCE)) {
    assert.throws(() => projectVerifiedGoodControl(), /P04_CONTROL_VERIFICATION_FAILED/);
    return;
  }
  const root = mkdtempSync(path.join(os.tmpdir(), 'cat-p04-source-'));
  try {
    const target = path.join(root, P04_CONTROL_SOURCE);
    mkdirSync(path.dirname(target), {recursive: true});
    writeFileSync(target, readFileSync(P04_CONTROL_SOURCE).subarray(1));
    assert.throws(() => projectVerifiedGoodControl(root), /P04_CONTROL_SOURCE_HASH/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('authority projector binds H0-1 document and scenario sources and matches its fixture', () => {
  const projected = projectH0AuthorityPreflight();
  assert.equal(serializePublicAuthorityPreflightV1(projected), readFileSync(humanPath, 'utf8').replace(/\r\n/g, '\n'));
  assert.equal(projected.case.headline, 'Automation stopped before execution because authority was ambiguous.');
  assert.equal(projected.decision, 'HUMAN_REQUIRED');
  assert.equal(projected.candidateAccepted, false);
  assert.equal(projected.authorityStatus, 'AMBIGUOUS');
  assert.equal(projected.execution, 'NOT_RUN');
  assert.equal(projected.historicalRun, false);
  assert.equal(projected.provenance.authorityDocumentSha256, '57a33018da0104be002855dc762ce8f4aa1449aaa3468891192010ccee17bc8e');

  const root = mkdtempSync(path.join(os.tmpdir(), 'cat-h0-source-'));
  try {
    const target = path.join(root, H0_AUTHORITY_SOURCE);
    mkdirSync(path.dirname(target), {recursive: true});
    writeFileSync(target, '## H0-1 — Archived account reactivation\n');
    assert.throws(() => projectH0AuthorityPreflight(root), /H0_AUTHORITY_SOURCE_HASH/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('R2A presentation labels preserve canonical evidence enums', () => {
  const human = readFileSync(humanPath, 'utf8');
  assert.match(human, /"decision": "HUMAN_REQUIRED"/);
  assert.match(human, /"execution": "NOT_RUN"/);
  assert.match(human, /"hiddenVerification": "NOT_APPLICABLE"/);
  assert.match(readFileSync(acceptedPath, 'utf8'), /"aggregateRunDecision": "REJECTED"/);
  const app = readFileSync(new URL('../console/app.js', import.meta.url), 'utf8');
  assert.match(app, /String\(value\)\.replaceAll\("_", " "\)/);
  assert.deepEqual(
    ['HUMAN_REQUIRED', 'NOT_RUN', 'NOT_APPLICABLE', 'LOCAL_DOCKER_FALLBACK'].map((label) => label.replaceAll('_', ' ')),
    ['HUMAN REQUIRED', 'NOT RUN', 'NOT APPLICABLE', 'LOCAL DOCKER FALLBACK'],
  );
  assert.match(app, /Human required · authority ambiguity/);
  assert.doesNotMatch(app, /authority requires human review/);
});

test('three archival schemas remain registered while current strict cases stay allowlisted', () => {
  assert.equal(PUBLIC_CASE_REGISTRY.length, 3);
  assert.equal(DEFAULT_PUBLIC_CASE_ID, 'node-cache-ttl-zero-001');
  assert.equal(loadPublicDecisionCase().id, DEFAULT_PUBLIC_CASE_ID);
  assert.doesNotThrow(() => loadPublicDecisionCase('h0-1-authority-preflight-001'));
  assert.equal(loadPublicFixtureCase('p04-good-control-001').id, 'p04-good-control-001');
  assert.throws(() => loadPublicDecisionCase('p04-good-control-001'), /P04_CONTROL_VERIFICATION_FAILED/);
  for (const id of ['', '../package.json', '%2e%2e%2fpackage.json', '%252e%252e%252fpackage.json', 'C:\\Windows\\win.ini', '\\\\server\\share', '.agent-runs/x', '.gortex/x', 'package.json']) {
    assert.throws(() => loadPublicDecisionCase(id), /PUBLIC_CASE_UNKNOWN/);
  }
});

test('every public fixture excludes private paths, challenge data, and unsupported provenance', () => {
  for (const file of [rejectedPath, acceptedPath, humanPath, scenarioPath]) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /[A-Za-z]:\\(?:Users|home)\\|\\\\[^"\s]+|\/home\/[^/\s]+|\.agent-runs|\.gortex|privateEvidence|holdoutSeal|challengeValue|"evaluations"/i);
  }
  for (const file of [acceptedPath, humanPath]) assert.doesNotMatch(readFileSync(file, 'utf8'), /"(?:provider|model|backend|patchSha256)"/i);
});
