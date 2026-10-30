import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {verifyP03ReceiptDetailed} from '../src/evaluation/p03-runner.ts';
import {verifyReceipt} from '../src/core/receipt.ts';
import {createHash} from 'node:crypto';

const require = createRequire(import.meta.url);
const evidence = require('../src/evaluation/p03-build-evidence.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'fixtures/hero/node-cache-ttl-zero-001/suite/source/index.js');
const historical = evidence.hydrateFrozenBytes(readFileSync(source));
const dateDrift = Buffer.from(historical.toString('utf8').replace('2026-10-06', '2026-10-07'));

test('date-only banner drift normalizes to the same build bytes', () => {
  assert.deepEqual(evidence.normalizeBuildBytes(historical, '3.2.1'), evidence.normalizeBuildBytes(dateDrift, '3.2.1'));
});
test('an executable mutation changes normalized build bytes', () => {
  const mutated = Buffer.from(historical);
  const body = mutated.indexOf(Buffer.from('*/\n')) + 3;
  mutated[body] = mutated[body] === 0x28 ? 0x29 : 0x28;
  assert.notDeepEqual(evidence.normalizeBuildBytes(historical, '3.2.1'), evidence.normalizeBuildBytes(mutated, '3.2.1'));
});
test('unexpected banner metadata fails closed', () => {
  const changed = Buffer.from(historical.toString('utf8').replace('Maintained by M. Peter', 'Maintained by N. Peter'));
  assert.throws(() => evidence.normalizeBuildBytes(changed, '3.2.1'), /BUILD_METADATA_NORMALIZATION_UNSAFE/);
});
test('a missing banner fails closed', () => {
  assert.throws(() => evidence.normalizeBuildBytes(Buffer.from('var exports;\n'), '3.2.1'), /BUILD_METADATA_NORMALIZATION_UNSAFE/);
});
test('duplicate or malformed volatile date fields fail closed', () => {
  const duplicate = Buffer.from(historical.toString('utf8').replace(' * https://github.com/tcs-de/nodecache\n', ' * Generated: 2026-10-07\n * https://github.com/tcs-de/nodecache\n'));
  const malformed = Buffer.from(historical.toString('utf8').replace('2026-10-06', '2026-99-06'));
  assert.throws(() => evidence.normalizeBuildBytes(duplicate, '3.2.1'), /BUILD_METADATA_NORMALIZATION_UNSAFE/);
  assert.throws(() => evidence.normalizeBuildBytes(malformed, '3.2.1'), /BUILD_METADATA_NORMALIZATION_UNSAFE/);
});
test('raw runtime identity remains distinct across banner dates', () => {
  assert.notEqual(evidence.sha256(historical), evidence.sha256(dateDrift));
  assert.deepEqual(evidence.normalizeBuildBytes(historical, '3.2.1'), evidence.normalizeBuildBytes(dateDrift, '3.2.1'));
});
test('the historical P03 receipt v2 keeps its valid envelope and exact incomplete artifact classification', () => {
  const file = path.join(root, 'evidence/historical/p03-v2/receipt-v2.1271e7ed0552bc752c714e27ce61b65e79ebbc3446879e05ff158126c54f735b.json');
  const bytes = readFileSync(file);
  const receipt = JSON.parse(bytes.toString('utf8'));
  const receiptHash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(receipt.receiptVersion, 2);
  assert.equal(receiptHash, '38b2917939ebe225bbbbf393a8a3469dbed54a9eb70a6d374b4e1ab209cd6038');
  assert.equal(verifyReceipt(receipt), true);
  assert.deepEqual(verifyP03ReceiptDetailed(receipt), {
    envelope: 'PASS', artifacts: 'UNAVAILABLE', overall: 'HISTORICAL_INCOMPLETE',
    missingArtifactIds: ['controller-runner'], issues: ['HISTORICAL_ARTIFACTS_NOT_RETAINED'],
  });
  assert.equal(receipt.artifactHashes['oracle-v1'], '4fbf4c5cbcc19b054e916800537c3ac77fdf2c6c3907a56cb5e29873b67b5722');
  assert.equal(receipt.artifactHashes['oracle-v2'], '72cb331c0d7f8ea85f8ff96625f329764bbcbdd784762e59b22e5c0c35c55231');
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), receiptHash);
});
