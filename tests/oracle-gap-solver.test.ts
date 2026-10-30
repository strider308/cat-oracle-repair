import assert from 'node:assert/strict';
import test from 'node:test';
import {solveOracleGap} from '../src/oracle/gap-solver.ts';

const base = () => ({
  authority: {status: 'SOURCE_SUPPORTED_CONTRACT' as const, clauseId: 'approved-clause', contractSha256: 'a'.repeat(64)},
  scenarioSha256: 'b'.repeat(64),
  inputSha256: 'c'.repeat(64),
  currentOracle: {observes: ['result'], expected: {result: 'ok'}},
  candidateFields: [
    {field: 'audit', expected: false, meaning: 'No side effect'},
    {field: 'expiresAt', expected: 0, meaning: 'No expiry'},
  ],
  controls: [
    {id: 'good', role: 'POSITIVE' as const, currentOutcome: 'PASS' as const, candidateSha256: 'd'.repeat(64), suiteObservation: {result: 'ok'}, observation: {result: 'ok', audit: false, expiresAt: 0}},
    {id: 'equivalent', role: 'POSITIVE' as const, currentOutcome: 'PASS' as const, candidateSha256: 'e'.repeat(64), suiteObservation: {result: 'ok'}, observation: {result: 'ok', audit: false, expiresAt: 0}},
    {id: 'survivor', role: 'SURVIVOR' as const, currentOutcome: 'PASS' as const, candidateSha256: 'f'.repeat(64), suiteObservation: {result: 'ok'}, observation: {result: 'ok', audit: false, expiresAt: 10}},
    {id: 'wrong', role: 'ALREADY_REJECTED' as const, currentOutcome: 'FAIL' as const, candidateSha256: '9'.repeat(64), suiteObservation: {result: 'denied'}, observation: {result: 'denied', audit: false, expiresAt: 0}},
  ],
});

test('solver returns tied minimum proposals and preserves positive and already-rejected controls', () => {
  const input = base();
  input.candidateFields.push({field: 'expired', expected: false, meaning: 'Entry is not expired'});
  for (const control of input.controls) {
    control.observation.expired = control.id === 'survivor';
    control.observation.audit = control.id === 'survivor';
  }
  input.controls[2].observation.expiresAt = 0;
  const result = solveOracleGap(input);
  assert.equal(result.status, 'PROPOSAL');
  assert.deepEqual(result.minimumAdditions, [
    {fields: ['audit'], expected: {audit: false}},
    {fields: ['expired'], expected: {expired: false}},
  ]);
  assert.deepEqual(result.searchBound, {candidateObservations: 3, maximumCandidateObservations: 12, subsetsEvaluated: 3});
  assert.equal(result.positiveControlsPreserved, true);
  assert.equal(result.alreadyRejectedControlsRemainRejected, true);
  assert.equal(result.scope, 'PROPOSED_OBSERVATIONS_REQUIRE_SPECIFICATION_REVIEW');
  assert.equal(Object.hasOwn(result, 'PROVEN'), false);
});

test('solver distinguishes a missing field from an observed null value', () => {
  const input = base();
  input.controls[2].observation.expiresAt = null;
  const proposal = solveOracleGap(input);
  assert.equal(proposal.status, 'PROPOSAL');
  assert.deepEqual(proposal.minimumAdditions, [{fields: ['expiresAt'], expected: {expiresAt: 0}}]);
  delete input.controls[2].observation.expiresAt;
  assert.equal(solveOracleGap(input).status, 'UNRESOLVED');
});

test('solver reports no solution when survivor and positive observations are indistinguishable', () => {
  const input = base();
  input.controls[2].observation.expiresAt = 0;
  const noSolution = solveOracleGap(input);
  assert.equal(noSolution.status, 'NO_SOLUTION');
  assert.equal((noSolution.searchBound as any).subsetsEvaluated, 3);
});

test('solver fails closed on contradictory positive controls, current results, authority, malformed data and excessive search', () => {
  const contradiction = base();
  contradiction.controls[1].observation.expiresAt = 4;
  assert.equal(solveOracleGap(contradiction).status, 'UNRESOLVED');

  const resultConflict = base();
  resultConflict.controls[0].currentOutcome = 'FAIL';
  assert.equal(solveOracleGap(resultConflict).status, 'UNRESOLVED');

  const unknownAuthority = base();
  (unknownAuthority.authority as any).status = 'UNKNOWN';
  assert.equal(solveOracleGap(unknownAuthority).status, 'UNSUPPORTED');

  const malformed = JSON.parse('{"__proto__":{},"authority":{}}');
  assert.equal(solveOracleGap(malformed).status, 'UNSUPPORTED');

  const excessive = base();
  excessive.candidateFields = Array.from({length: 13}, (_, index) => ({field: `field${index}`, expected: 0, meaning: 'bounded test'}));
  assert.equal(solveOracleGap(excessive).status, 'UNSUPPORTED');
});

test('solver result and input hash are independent of control and candidate order', () => {
  const input = base();
  const first = solveOracleGap(input);
  input.controls.reverse();
  input.candidateFields.reverse();
  const second = solveOracleGap(input);
  assert.deepEqual(second, first);
  assert.notEqual(solveOracleGap({...base(), authority: {...base().authority, contractSha256: 'b'.repeat(64)}}).inputSha256, first.inputSha256);
});
