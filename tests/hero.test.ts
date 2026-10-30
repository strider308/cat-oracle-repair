import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {finalizeReceipt, verifyReceipt} from '../src/core/receipt.ts';
import {inconclusiveResult, parseTargetObservation, runHero} from '../src/evaluation/hero-runner.ts';
import {OracleStatus, validateSources, verifyP03Receipt, verifyP03ReceiptDetailed} from '../src/evaluation/p03-runner.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const caseDir = path.join(root, 'fixtures/hero/node-cache-ttl-zero-001');
const hash = (value) => createHash('sha256').update(value).digest('hex');

test('P03 executes and calibrates its frozen oracle against real controls', async (t) => {
  const result = await runHero();
  const manifest = JSON.parse(readFileSync(path.join(caseDir, 'manifest.json'), 'utf8'));

  await t.test('exact upstream candidates bind to their executable artifacts', () => {
    assert.equal(result.candidates.wrong.candidateSha, manifest.candidates.find((item) => item.name === 'wrong').artifactSha256);
    assert.equal(result.candidates.good.candidateSha, manifest.candidates.find((item) => item.name === 'good').artifactSha256);
    assert.deepEqual(result.candidates.wrong.runtime, result.suite.frozenRuntime.v3);
    assert.deepEqual(result.candidates.good.runtime, result.suite.frozenRuntime.v4);
    assert.equal(result.candidates.wrong.sourceTreeSha256, result.suite.sourceTrees.v3);
    assert.equal(result.candidates.good.sourceTreeSha256, result.suite.sourceTrees.v4);
  });

  await t.test('existing suite evidence comes from the current original-suite execution', () => {
    assert.deepEqual([result.suite.exitCode, result.suite.testsPassed, result.suite.testsFailed, result.suite.result], [0, 8, 0, 'PASS']);
    assert.match(result.suite.stdoutHash, /^[a-f0-9]{64}$/);
    assert.match(result.suite.stderrHash, /^[a-f0-9]{64}$/);
  });

  await t.test('core receipt envelope remains distinct from artifact verification', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cat-p03-receipt-'));
    try {
      const bytes = 'frozen suite evidence';
      writeFileSync(path.join(dir, 'artifact.bin'), bytes);
      const candidate = {candidateSha: 'candidate', contractHash: 'contract', jobStatus: 'COMPLETED', decision: 'ACCEPTED',
        reasonCodes: [], requiredGateIds: ['suite'], gates: {suite: 'PASS'}, evidenceManifestHash: 'a'.repeat(64)};
      const receipt = finalizeReceipt({receiptVersion: 2, runId: randomUUID(), createdAt: new Date().toISOString(), baseSha: 'base',
        candidate, environmentDigest: 'env', sourceHashes: {}, artifactPaths: {suite: 'artifact.bin'},
        artifactHashes: {suite: hash(bytes)}, commands: [], modelIds: [], providerOperationIds: [], knownLimits: [], previousEventHash: null});
      assert.equal(verifyReceipt(receipt, dir), true);
      assert.equal(verifyP03Receipt(receipt, dir), false);
      writeFileSync(path.join(dir, 'artifact.bin'), 'mutated evidence');
      assert.equal(verifyReceipt(receipt, dir), true);
      assert.equal(verifyP03Receipt(receipt, dir), false);
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });

  await t.test('source content and excerpt hashes have distinct meanings', () => {
    const sources = JSON.parse(readFileSync(path.join(caseDir, 'sources.json'), 'utf8'));
    assert.equal(Object.keys(validateSources(sources)).length, sources.length);
    assert.notEqual(sources[0].artifactSha256, sources[0].supportingSpanSha256);
  });

  await t.test('source artifact mutation is detected by the current P03 verifier', () => {
    const receipt = JSON.parse(readFileSync(path.join(root, result.receiptPath), 'utf8'));
    const artifact = receipt.artifactManifest.artifacts.find((item) => item.id.startsWith('source-'));
    const artifactPath = path.join(root, artifact.workspaceLocator);
    const original = readFileSync(artifactPath);
    assert.equal(verifyP03Receipt(receipt), true);
    const changed = Buffer.from(original);
    changed[0] = changed[0] ^ 1;
    try {
      writeFileSync(artifactPath, changed);
      assert.equal(verifyP03Receipt(receipt), false);
    } finally {
      writeFileSync(artifactPath, original);
    }
    assert.equal(verifyP03Receipt(receipt), true);
  });

  await t.test('V1 is frozen and calibration begins uncalibrated', () => {
    assert.match(result.v1Hash, /^[a-f0-9]{64}$/);
    assert.equal(result.initialStatus, OracleStatus.UNCALIBRATED);
  });

  await t.test('V1 rejects the exact wrong 3.2.1 behavior', () => assert.equal(result.v1Results.wrong, 'FAIL'));

  await t.test('V1 accepts exact known-good 4.0.0 behavior', () => assert.equal(result.v1Results.good, 'PASS'));

  await t.test('V1 accepts the equivalent correct control', () => assert.equal(result.v1Results.equivalent, 'PASS'));

  await t.test('S1 preserves the key and survives V1', () => {
    assert.deepEqual(result.candidates.survivor.v1, {ttlReturned: true, found: true, value: 'value', expiresAt: result.candidates.survivor.v1.expiresAt});
    assert.equal(result.v1Results.survivor, 'PASS');
  });

  await t.test('S1 violates the sourced no-expiry clause', () => {
    assert.ok(result.candidates.survivor.v1.expiresAt > Date.now());
    assert.deepEqual(result.attack.violatedClauseIds, ['ttl-zero-refreshes-without-expiry']);
  });

  await t.test('V1 is classified WEAK after S1 survives', () => assert.equal(result.postAttackStatus, OracleStatus.WEAK));

  await t.test('V2 rejects S1', () => {
    assert.match(result.v2Hash, /^[a-f0-9]{64}$/);
    assert.equal(result.v2Results.survivor, 'FAIL');
  });

  await t.test('V2 retains the exact known-good implementation', () => assert.equal(result.v2Results.good, 'PASS'));

  await t.test('V2 retains the equivalent correct implementation', () => assert.equal(result.v2Results.equivalent, 'PASS'));

  await t.test('target observations cannot self-report CAT authority', () => {
    assert.throws(() => parseTargetObservation('{"ttlReturned":true,"found":true,"value":"value","oracleStatus":"CALIBRATED"}'), /TARGET_PROTOCOL_INVALID/);
  });

  await t.test('operational failure remains inconclusive', () => {
    const failed = inconclusiveResult('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64));
    assert.equal(failed.jobStatus, 'INCONCLUSIVE');
    assert.equal(failed.decision, null);
  });

  await t.test('legitimate P03 receipt rehashes every referenced artifact', () => {
    const receipt = JSON.parse(readFileSync(path.join(root, result.receiptPath), 'utf8'));
    assert.equal(receipt.receiptVersion, 4);
    assert.equal(verifyReceipt(receipt), true);
    assert.equal(verifyP03Receipt(receipt), true);
  });

  await t.test('final oracle status is calibrated only after every control passes', () => {
    assert.equal(result.v2Results.wrong, 'FAIL');
    assert.equal(result.oracleStatus, OracleStatus.CALIBRATED);
    assert.equal(result.result.jobStatus, 'COMPLETED');
    assert.equal(result.result.decision, 'REJECTED');
  });
});
