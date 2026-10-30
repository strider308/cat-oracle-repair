import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {loadTestDiscriminationSummary, serializeTestDiscriminationSummary} from '../src/evidence/test-discrimination-summary.ts';

test('Test Discrimination Summary binds the recorded P03 outcomes to exact public artifact bytes', () => {
  const {summary, sourceFiles} = loadTestDiscriminationSummary();
  assert.equal(summary.schema, 'CatTestDiscriminationSummaryV3');
  assert.equal(summary.baselineReleaseSha, '32208efa9ec2a034431629af94bfd15f49870db5');
  assert.equal(summary.publicOracleStatus, 'WEAK');
  assert.equal(summary.historicalCalibration, 'CALIBRATED');
  assert.equal(summary.historicalP03.resultScope, 'RECORDED_HISTORICAL_CONTROLS');
  assert.equal(summary.historicalP03.archivedReceiptVerification, 'HISTORICAL_INCOMPLETE');
  assert.deepEqual(summary.historicalP03.missingArtifactIds, ['controller-runner']);
  assert.deepEqual(summary.controls.map(({id, v1, v2}) => [id, v1, v2]), [
    ['known-wrong', 'FAIL', 'FAIL'],
    ['known-good', 'PASS', 'PASS'],
    ['finite-expiry-survivor', 'PASS', 'FAIL'],
    ['equivalent', 'PASS', 'PASS'],
  ]);
  assert.equal(summary.oracleGap.status, 'PROPOSAL');
  assert.deepEqual(summary.oracleGap.minimumAdditions, [{fields: ['expiresAt'], expected: {expiresAt: 0}}]);
  assert.deepEqual(summary.oracleGap.searchBound, {candidateObservations: 1, maximumCandidateObservations: 12, subsetsEvaluated: 1});
  assert.deepEqual(summary.oracleGap.beforeAfter.map(({id, before, after}) => [id, before, after]), [
    ['known-good', 'PASS', 'PASS'],
    ['equivalent', 'PASS', 'PASS'],
    ['finite-expiry-survivor', 'PASS', 'FAIL'],
    ['known-wrong', 'FAIL', 'FAIL'],
  ]);
  assert.equal(summary.oracleGap.publicStatusEffect, 'NONE_PUBLIC_ORACLE_REMAINS_WEAK');
  assert.deepEqual(summary.executableOracleRepairs.map(({caseId, verificationStatus}: any) => [caseId, verificationStatus]), [
    ['h0-2-export', 'EXECUTED_VERIFIED_CASE_SCOPE'], ['idempotency', 'EXECUTED_VERIFIED_CASE_SCOPE'],
  ]);
  assert.equal(summary.controls[0].existingSuite, 'PASS');
  assert.equal(summary.controls[0].existingSuiteTests, 8);
  assert.ok(sourceFiles.length >= 6);
  for (const source of sourceFiles) assert.equal(createHash('sha256').update(source.bytes).digest('hex'), source.sha256, source.path);
});

test('Test Discrimination Summary serialization is stable and public-safe', () => {
  const serialized = serializeTestDiscriminationSummary();
  assert.equal(serialized, serializeTestDiscriminationSummary());
  assert.doesNotMatch(serialized, /C:\\\\Users\\\\|privateEvidence|holdoutSeal|Bearer\s/i);
  assert.match(serialized, /"publicOracleStatus": "WEAK"/);
  assert.match(serialized, /HISTORICAL_INCOMPLETE/);
});
