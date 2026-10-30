import assert from 'node:assert/strict';
import test from 'node:test';
import {runOracleRepairDemonstrations, verifyOracleRepairReceipt} from '../src/oracle/execute-fixtures.ts';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createOracleObservationPreparationManifest, createOracleObservationRequest, evaluateOracleObservationProposal, validateOracleObservationResponse} from '../src/oracle/observation-proposal.ts';
import {buildTokenFactoryObservationBody} from '../src/runtime/nebius.ts';

const root = path.resolve(import.meta.dirname, '..');

test('executable oracle repair verifies same-input controls and source-bound child receipts', () => {
  const receipts = runOracleRepairDemonstrations();
  assert.deepEqual(receipts.map(({caseId, verificationStatus}) => [caseId, verificationStatus]), [
    ['h0-2-export', 'EXECUTED_VERIFIED_CASE_SCOPE'], ['idempotency', 'EXECUTED_VERIFIED_CASE_SCOPE'],
  ]);
  for (const receipt of receipts) {
    assert.equal(verifyOracleRepairReceipt(receipt), true);
    assert.equal(receipt.securityBoundary, 'PROCESS_SEPARATION_ONLY_NOT_DOCKER_SECURITY_ISOLATION');
    assert.equal(receipt.controls.every((control: any) => control.observation !== null), true);
    assert.equal(receipt.executions.every((run: any) => run.deterministic && run.attempts.length === 2), true);
    assert.deepEqual(receipt.controls.map((control: any) => control.combinedFinalAcceptance), ['ACCEPT', 'ACCEPT', 'REJECT', 'REJECT']);
  }
  assert.equal(receipts[0].specificationStatus, 'HUMAN_APPROVED_SOURCE');
  assert.deepEqual(receipts[0].controls.map((control: any) => control.observation.response), ['DENY', 'DENY', 'ALLOW', 'DENY']);
  assert.deepEqual(receipts[1].controls.map((control: any) => control.observation.balance), [5, 5, 10, 0]);
  assert.equal(receipts[1].specificationStatus, 'SYNTHETIC_DRAFT');
});

test('executable receipt verifier rejects changed scenario, input, source or outcome', () => {
  const [receipt] = runOracleRepairDemonstrations();
  const scenario = structuredClone(receipt);
  scenario.input.record.tenant = 'north';
  assert.equal(verifyOracleRepairReceipt(scenario), false);
  const source = structuredClone(receipt);
  source.executions[0].candidateSha256 = '0'.repeat(64);
  assert.equal(verifyOracleRepairReceipt(source), false);
  const output = structuredClone(receipt);
  output.controls[0].combinedFinalAcceptance = 'REJECT';
  assert.equal(verifyOracleRepairReceipt(output), false);
});

test('simulated observation proposals select bounded scenarios without receiving repair outcomes', () => {
  const [receipt] = runOracleRepairDemonstrations();
  const request = createOracleObservationRequest({receipt, root, contractText: readFileSync(path.join(root, receipt.contractPath), 'utf8')});
  assert.equal(request.value.model, 'nvidia/nemotron-3-super-120b-a12b');
  assert.equal(request.value.scenarioOptions.length, 4);
  assert.equal(request.value.originalAcceptanceSuite.length, 2);
  assert.equal(JSON.stringify(request.value).includes('controls'), false);
  assert.equal(JSON.stringify(request.value).includes('survivor'), false);
  assert.equal(JSON.stringify(request.value).includes('proposedAssertion'), false);
  assert.match(request.packageSha256, /^[a-f0-9]{64}$/);
  const body = buildTokenFactoryObservationBody(request.value.model, request.prompt, {type: 'object'});
  for (const serialized of [request.prompt, body]) {
    assert.equal(serialized.includes('survivor'), false);
    assert.equal(serialized.includes('proposedAssertion'), false);
    assert.equal(serialized.includes('controls'), false);
  }
  const manifest = JSON.parse(JSON.stringify(createOracleObservationPreparationManifest(request, body, 'https://api.tokenfactory.nebius.com/v1/chat/completions')));
  assert.match(manifest.fixtureSourceTreeSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.proposalTreeSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(manifest, 'sourceTreeSha256'), false);
  assert.equal(manifest.package.bytes, Buffer.byteLength(request.packageBytes));
  assert.equal(manifest.httpBody.bytes, Buffer.byteLength(body));
  const propose = (scenarioId: string, expected: string) => validateOracleObservationResponse(JSON.stringify({scenarioId, field: 'response', expected, rationale: 'Compare the observable response with the approved contract.'}), request);
  const successfulSimulation = propose('cross-tenant-authorized', 'DENY');
  const success = evaluateOracleObservationProposal({receipt, proposal: successfulSimulation.proposal, root});
  assert.equal(success.status, 'PROPOSAL_VERIFIED_CASE_SCOPE');
  assert.deepEqual(success.metrics, {falseAcceptance: 0, falseRejection: 0, positiveControlPreservation: true, survivorDetection: true, alreadyRejectedPreserved: true});
  const irrelevantSimulation = evaluateOracleObservationProposal({receipt, proposal: propose('same-tenant-authorized', 'ALLOW').proposal, root});
  assert.equal(irrelevantSimulation.status, 'UNRESOLVED');
  assert.equal(irrelevantSimulation.authorityAssessment, 'EXISTING_SUITE_EXPECTATION_ONLY');
  assert.ok(irrelevantSimulation.reasonCodes.includes('INSUFFICIENT_SPECIFICATION_AUTHORITY'));
  assert.equal(irrelevantSimulation.metrics.falseAcceptance, 1);
  assert.equal(irrelevantSimulation.metrics.survivorDetection, false);
  const contradictorySimulation = evaluateOracleObservationProposal({receipt, proposal: propose('cross-tenant-authorized', 'ALLOW').proposal, root});
  assert.equal(contradictorySimulation.status, 'UNSUPPORTED');
  assert.equal(contradictorySimulation.authorityAssessment, 'CONTRACT_INCONSISTENT');
  assert.ok(contradictorySimulation.reasonCodes.includes('CONTRACT_INCONSISTENT'));
  assert.equal(contradictorySimulation.metrics.falseRejection, 2);
  const overstrictSimulation = evaluateOracleObservationProposal({receipt, proposal: propose('same-tenant-authorized', 'DENY').proposal, root});
  assert.equal(overstrictSimulation.status, 'UNRESOLVED');
  assert.equal(overstrictSimulation.authorityAssessment, 'INSUFFICIENT_SPECIFICATION_AUTHORITY');
  assert.equal(overstrictSimulation.metrics.falseRejection, 2);
  assert.ok(overstrictSimulation.reasonCodes.includes('INSUFFICIENT_SPECIFICATION_AUTHORITY'));
  assert.ok(overstrictSimulation.reasonCodes.includes('POSITIVE_CONTROL_REJECTION'));
  const supportedUnauthorizedDeny = evaluateOracleObservationProposal({receipt, proposal: propose('same-tenant-unauthorized', 'DENY').proposal, root});
  assert.equal(supportedUnauthorizedDeny.authorityAssessment, 'CONTRACT_SUPPORTED');
  const unauthorizedAllow = evaluateOracleObservationProposal({receipt, proposal: propose('same-tenant-unauthorized', 'ALLOW').proposal, root});
  assert.equal(unauthorizedAllow.status, 'UNSUPPORTED');
  assert.equal(unauthorizedAllow.authorityAssessment, 'CONTRACT_INCONSISTENT');
  for (const response of [
    {scenarioId: 'made-up', field: 'response', expected: 'DENY', rationale: 'injected'},
    {scenarioId: 'cross-tenant-authorized', field: 'response', expected: 'DENY', rationale: 'x', code: 'arbitrary code'},
    {scenarioId: 'cross-tenant-authorized', field: 'response', expected: 'MAYBE', rationale: 'invalid value'},
  ]) assert.throws(() => validateOracleObservationResponse(JSON.stringify(response), request), /ORACLE_OBSERVATION_RESPONSE_SCHEMA_INVALID/);
  assert.equal(evaluateOracleObservationProposal({receipt: {...receipt, receiptSha256: '0'.repeat(64)}, proposal: successfulSimulation.proposal, root}).status, 'UNRESOLVED');
});
