import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical, project} from '../src/oracle/canonical.ts';
import {evaluateObservation} from '../src/oracle/evaluate.ts';
import {calibrateOracle} from '../src/oracle/calibrate.ts';
import {createHoldout, HOLDOUT_GENERATOR_VERSION} from '../src/verifier/holdout-generator.ts';
import {decideFinal, sha256, verifyHoldout} from '../src/verifier/sealed-verifier.ts';
import {verifyP04Receipt} from '../src/verifier/receipt-v3.ts';
import {finalizeReceipt} from '../src/core/receipt.ts';
import {runtimeDependencyPaths} from '../src/verifier/runtime-dependencies.ts';
import {stopTimedOutContainer} from '../src/verifier/docker-cleanup.ts';
import {verifyP03ReceiptDetailed, verifyP03SupersessionRecord} from '../src/evaluation/p03-runner.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASE_REL = 'fixtures/hero/node-cache-ttl-zero-001';
const oracle = {id: 'counter', version: 1, visibility: 'PUBLIC' as const, observes: ['result'], expected: {result: 4}};
const s2Source = readFileSync(new URL('../fixtures/hero/node-cache-ttl-zero-001/candidates/s2-overbroad-zero-fix/index.js', import.meta.url), 'utf8');
const s2Module = {exports: {}};
runInNewContext(s2Source, {module: s2Module});
const S2 = s2Module.exports as any;
function selectP03Supersession() {
  const tracked = execFileSync('git', ['ls-files', '--', 'evidence/manifests/p03-supersession-*.json'], {cwd: ROOT, encoding: 'utf8'}).trim().split(/\r?\n/).filter(Boolean);
  const candidates = tracked.length ? tracked : readdirSync(path.join(ROOT, 'evidence/manifests')).filter((name) => name.startsWith('p03-supersession-') && name.endsWith('.json'))
    .map((name) => 'evidence/manifests/' + name).sort((a, b) => statSync(path.join(ROOT, b)).mtimeMs - statSync(path.join(ROOT, a)).mtimeMs);
  for (const relativePath of candidates) {
    const record = JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));
    if (verifyP03SupersessionRecord(record, ROOT)) return {relativePath, record};
  }
  throw new Error('P03_SUPERSESSION_FIXTURE_UNAVAILABLE');
}
const P03_SUPERSESSION = selectP03Supersession();

function validP04Fixture(baseDir: string) {
  const dir = path.join(baseDir, 'repo');
  mkdirSync(dir, {recursive: true});
  const runId = 'd5a4e050-42a8-47f7-8f28-2f211275aff4';
  const caseDir = path.join(dir, CASE_REL);
  const copy = (rel: string) => {
    const source = path.join(ROOT, rel);
    const target = path.join(dir, rel);
    mkdirSync(path.dirname(target), {recursive: true});
    cpSync(source, target);
    return target;
  };
  const fixedPaths: Record<string, string> = {
    'contract-v3': CASE_REL + '/contract-v3.json', 'public-oracle-v2': CASE_REL + '/oracle-v2.json', 'source-records': CASE_REL + '/sources.json',
    'source-v3-code': CASE_REL + '/upstream/3.2.1/_src/lib/node_cache.coffee', 'source-v4-code': CASE_REL + '/upstream/4.0.0/_src/lib/node_cache.coffee',
    'source-v4-api': CASE_REL + '/upstream/node-cache-4.0.0-README.md', 'public-witness': CASE_REL + '/witness.json', 'suite-lockfile': CASE_REL + '/suite/package-lock.json',
    'implementation-candidate-adapter': CASE_REL + '/adapter.cjs', 'implementation-holdout-generator': 'src/verifier/holdout-generator.ts',
    'implementation-oracle-calibrate': 'src/oracle/calibrate.ts', 'implementation-oracle-canonical': 'src/oracle/canonical.ts', 'implementation-oracle-evaluate': 'src/oracle/evaluate.ts',
    'implementation-p04-runner': 'scripts/cat-sealed.ts', 'implementation-package-manifest': 'package.json', 'implementation-receipt-core': 'src/core/receipt.ts',
    'implementation-receipt-verifier': 'src/verifier/receipt-v3.ts', 'implementation-p03-replay-verifier': 'src/evaluation/p03-runner.ts', 'implementation-runtime-dependencies': 'src/verifier/runtime-dependencies.ts',
    'implementation-sealed-verifier': 'src/verifier/sealed-verifier.ts', 'implementation-docker-cleanup': 'src/verifier/docker-cleanup.ts',
  };
  const artifactPaths: Record<string, string> = {};
  for (const [id, rel] of Object.entries(fixedPaths)) { copy(rel); artifactPaths[id] = rel; }
  const candidateDirs = {v3: 'suite/source', good: 'upstream/4.0.0', equivalent: 'candidates/equivalent', s2: 'candidates/s2-overbroad-zero-fix'};
  const candidateFiles = {v3: ['index.js', 'lib/node_cache.js'], good: ['index.js', 'lib/node_cache.js'], equivalent: ['index.js'], s2: ['index.js']};
  const candidateProjectionManifests = Object.fromEntries(Object.entries(candidateFiles).map(([name, files]) => [name, files.map((file) => {
    const rel = CASE_REL + '/' + candidateDirs[name] + '/' + file;
    const target = copy(rel);
    return {path: file, sha256: sha256(readFileSync(target))};
  })]));
  const candidateWorkspaceHashes = Object.fromEntries(Object.entries(candidateProjectionManifests).map(([name, rows]) => [name, digest(canonical(rows))]));
  const workspaceHash = candidateWorkspaceHashes.s2;
  for (const [name, rows] of Object.entries(candidateProjectionManifests)) for (const row of rows) {
    artifactPaths['candidate-' + name + '-' + row.path.replaceAll('/', '-')] = CASE_REL + '/' + candidateDirs[name] + '/' + row.path;
  }
  const sourceSuite = path.join(ROOT, CASE_REL, 'suite');
  const targetSuite = path.join(caseDir, 'suite');
  mkdirSync(targetSuite, {recursive: true});
  copy(CASE_REL + '/suite/package.json');
  for (const rel of runtimeDependencyPaths(sourceSuite)) copy(CASE_REL + '/suite/node_modules/' + rel);
  const dependencyManifest = runtimeDependencyPaths(targetSuite).map((rel) => ({path: rel.split(path.sep).join('/'), sha256: sha256(readFileSync(path.join(targetSuite, 'node_modules', rel)))})).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  for (const row of dependencyManifest) artifactPaths['runtime-dependency-' + row.path.replaceAll('/', '-')] = CASE_REL + '/suite/node_modules/' + row.path;
  const evidenceBytes = Buffer.from('frozen evidence');
  const publicResults = {equivalent: 'PASS', good: 'PASS', s2: 'PASS', v3: 'FAIL'};
  const sealedResults = {equivalent: 'PASS', good: 'PASS', s2: 'FAIL', v3: 'NOT_RUN'};
  const decisions = {equivalent: 'ACCEPTED', good: 'ACCEPTED', s2: 'REJECTED', v3: 'REJECTED'};
  const challenge = {key: 'k', value: 'v', initialTtlSeconds: 8, updatedTtlSeconds: 5};
  const holdoutPack = {generatorVersion: HOLDOUT_GENERATOR_VERSION, challenges: [challenge]};
  const evaluations = Object.fromEntries(['s2', 'good', 'equivalent'].map((name) => [name, {startedAtMs: 100000, finishedAtMs: 101000,
    observation: {ttlReturned: true, found: true, value: 'v', expiresAt: name === 's2' ? 0 : 105000}}]));
  const privateEvidenceId = 'cat-p04-verifier-' + runId;
  const p03SupersessionPath = P03_SUPERSESSION.relativePath;
  const p03Supersession = P03_SUPERSESSION.record;
  const p03ReceiptPath = p03Supersession.newReceiptPath;
  const p03RunId = path.basename(p03ReceiptPath, '.json');
  const p03Store = path.resolve(path.dirname(dir), 'cat-p04-recovery/p03-durable-evidence/sha256');
  const mainP03Store = path.resolve(path.dirname(ROOT), 'cat-p04-recovery/p03-durable-evidence/sha256');
  mkdirSync(p03Store, {recursive: true});
  const p03ReceiptBytes = readFileSync(path.join(mainP03Store, p03Supersession.newReceiptFileSha256));
  const p03Receipt = JSON.parse(p03ReceiptBytes.toString('utf8'));
  const persistP03Object = (sha256: string) => {
    const target = path.join(p03Store, sha256);
    if (!existsSync(target)) cpSync(path.join(mainP03Store, sha256), target);
  };
  persistP03Object(p03Supersession.newReceiptFileSha256);
  for (const row of p03Receipt.artifactManifest.artifacts) {
    persistP03Object(row.sha256);
    if (row.workspaceLocator) copy(row.workspaceLocator);
  }
  copy(p03SupersessionPath);
  copy(p03Supersession.recoveryInventoryPath);
  for (const name of readdirSync(path.join(ROOT, 'evidence/historical/p03-v2'))) copy('evidence/historical/p03-v2/' + name);
  mkdirSync(path.dirname(path.join(dir, p03ReceiptPath)), {recursive: true});
  writeFileSync(path.join(dir, p03ReceiptPath), p03ReceiptBytes);
  artifactPaths['p03-current-receipt'] = p03ReceiptPath;
  artifactPaths['p03-supersession-record'] = p03SupersessionPath;
  const annexBytes = Buffer.from(JSON.stringify({version: 1, runId, privateEvidenceId, holdoutPack, evaluations}));
  const privateEvidencePath = `evidence/sealed-private/${runId}.json`;
  mkdirSync(path.dirname(path.join(dir, privateEvidencePath)), {recursive: true});
  writeFileSync(path.join(dir, privateEvidencePath), annexBytes);
  artifactPaths['private-evidence'] = privateEvidencePath;
  const leakageBytes = Buffer.from(JSON.stringify({gitMetadataAccessible: false, privateEvaluatorAccessible: false,
    sensitiveEnvironmentNamesPresent: false, outboundNetworkAccessible: false, candidateWorkspaceHash: workspaceHash, result: 'PASS'}));
  const leakageRel = `evidence/sealed/${runId}-leakage.json`;
  mkdirSync(path.dirname(path.join(dir, leakageRel)), {recursive: true});
  writeFileSync(path.join(dir, leakageRel), leakageBytes);
  artifactPaths.leakage = leakageRel;
  const artifactHashes = Object.fromEntries(Object.entries(artifactPaths).map(([id, rel]) => [id, sha256(readFileSync(path.join(dir, rel)))]));
  const implementationIds = Object.keys(fixedPaths).filter((id) => id.startsWith('implementation-')).map((id) => id.slice('implementation-'.length));
  const contractHash = artifactHashes['contract-v3'];
  const publicOracleHash = artifactHashes['public-oracle-v2'];
  const evidenceManifestHash = digest(canonical({publicResults, sealedResults, decisions}));
  const receiptBase: any = {receiptVersion: 4, runId, createdAt: new Date().toISOString(), baseSha: 'base',
    p03ReplayRunId: p03RunId, p03ReplayReceiptHash: p03Receipt.receiptHash, p03HistoricalReceiptHash: p03Supersession.historicalReceiptHash,
    p03SupersessionRecordPath: p03SupersessionPath, p03SupersessionRecordHash: sha256(readFileSync(path.join(dir, p03SupersessionPath))),
    candidate: {candidateSha: workspaceHash, contractHash, jobStatus: 'COMPLETED', decision: 'REJECTED',
      reasonCodes: ['PUBLIC_PASS', 'SEALED_HOLDOUT_FAIL'], requiredGateIds: ['public-v2', 'sealed-positive-expiry'],
      gates: {'public-v2': 'PASS', 'sealed-positive-expiry': 'FAIL'}, evidenceManifestHash},
    contractHash, publicOracleHash, publicOracleStatus: 'WEAK', holdoutGeneratorVersion: HOLDOUT_GENERATOR_VERSION,
    holdoutStatus: 'EXECUTED', holdoutSeal: sha256(Buffer.from(canonical(holdoutPack))), holdoutChallengeCount: 1,
    sealCreatedAt: '2026-10-06T12:00:00.000Z', candidateStartedAt: '2026-10-06T12:00:00.001Z',
    candidateWorkspaceHash: workspaceHash, candidateWorkspaceHashes, candidateProjectionManifests,
    adversarialCandidate: {id: 'S2-overbroad-zero-fix', candidateArtifactHash: workspaceHash, provenance: 'MANUAL_RESEARCH',
      violatedClauseIds: ['positive-ttl-refresh-remains-finite'], publicOracleOutcome: 'PASS', sealedOutcome: 'FAIL'},
    publicResults, sealedResults, decisions, leakageEvidenceHash: sha256(leakageBytes),
    privateEvidenceId, privateEvidenceSha256: sha256(annexBytes), privateEvidencePath,
    runtimeDependencyTreeHash: digest(canonical(dependencyManifest)), runtimeDependencyManifest: dependencyManifest,
    implementationHashes: Object.fromEntries(implementationIds.map((id) => [id, artifactHashes['implementation-' + id]])), environmentDigest: sha256(evidenceBytes),
    sourceHashes: {contract: contractHash, publicOracle: publicOracleHash, sourceV3Code: artifactHashes['source-v3-code'], sourceV4Code: artifactHashes['source-v4-code'], sourceV4Api: artifactHashes['source-v4-api']},
    artifactPaths, artifactHashes, commands: [], modelIds: [], providerOperationIds: [], knownLimits: [], previousEventHash: null};
  return {receipt: finalizeReceipt(receiptBase), annexBytes, root: dir, p03ReceiptPath, p03Store};
}

test('generic oracle evaluates the node-cache observation shape', () => {
  assert.equal(evaluateObservation({ttlReturned: true, found: true, value: 'x', expiresAt: 0}, { ...oracle, observes: ['found', 'expiresAt'], expected: {found: true, expiresAt: 0}}), 'PASS');
});
test('generic oracle evaluates an unrelated integer observation shape', () => assert.equal(evaluateObservation({result: 4}, oracle), 'PASS'));
test('generic observation projection ignores unobserved fields', () => assert.deepEqual(project({result: 4, noise: true}, ['result']), {result: 4}));
test('canonical serialization is stable across key order', () => assert.equal(canonical({b: 2, a: 1}), canonical({a: 1, b: 2})));
test('generic oracle reports a semantic mismatch as FAIL', () => assert.equal(evaluateObservation({result: 3}, oracle), 'FAIL'));
test('generic oracle reports malformed observations as ERROR', () => assert.equal(evaluateObservation(null as any, oracle), 'ERROR'));
test('S2 passes the released zero-TTL public V2 observation', () => {
  const cache = new S2(); cache.set('public', 'value', 31); cache.ttl('public', 0);
  const observation = {ttlReturned: true, found: cache.get('public') === 'value', value: cache.get('public'), expiresAt: cache.getTtl('public')};
  assert.equal(evaluateObservation(observation, {id: 'ORACLE_V2', version: 2, visibility: 'PUBLIC', observes: ['ttlReturned', 'found', 'value', 'expiresAt'], expected: {ttlReturned: true, found: true, value: 'value', expiresAt: 0}}), 'PASS');
});
test('S2 violates the sourced positive finite-expiry preservation behavior', () => {
  const cache = new S2(); cache.set('private', 'value', 31); const started = Date.now(); cache.ttl('private', 37);
  assert.equal(cache.get('private'), 'value'); assert.equal(cache.getTtl('private'), 0); assert.ok(cache.getTtl('private') <= started);
});
test('calibration becomes WEAK when an attack survives', () => assert.equal(calibrateOracle(true, true, true, false), 'WEAK'));
test('calibration requires both controls and wrong-candidate rejection', () => assert.equal(calibrateOracle(false, true, true, true), 'UNCALIBRATED'));
test('calibration accepts a fully discriminating oracle', () => assert.equal(calibrateOracle(true, true, true, true), 'CALIBRATED'));
test('reusable oracle modules contain no case-specific evaluation vocabulary', () => {
  for (const file of ['canonical.ts', 'evaluate.ts', 'calibrate.ts']) {
    const source = readFileSync(new URL('../src/oracle/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /node-cache|ttl|expiry|cache key|getTtl/i);
  }
});
test('holdout generator identifies its version and creates a random challenge', () => {
  const a = createHoldout(); const b = createHoldout();
  try { assert.equal(a.challenge.key === b.challenge.key, false); assert.equal(HOLDOUT_GENERATOR_VERSION, 'positive-expiry-v1'); }
  finally { rmSync(path.dirname(a.artifactPath), {recursive: true, force: true}); rmSync(path.dirname(b.artifactPath), {recursive: true, force: true}); }
});
test('holdout bytes have a stable seal', () => {
  const run = createHoldout();
  try { assert.equal(verifyHoldout(run.bytes, run.seal), true); }
  finally { rmSync(path.dirname(run.artifactPath), {recursive: true, force: true}); }
});
test('mutating sealed holdout bytes invalidates the seal', () => {
  const run = createHoldout();
  try { assert.equal(verifyHoldout(Buffer.from(run.bytes.toString() + ' '), run.seal), false); }
  finally { rmSync(path.dirname(run.artifactPath), {recursive: true, force: true}); }
});
test('holdout artifact is sealed before the recorded candidate start', () => {
  const run = createHoldout();
  try { const startedAt = new Date(Date.parse(run.sealCreatedAt) + 1).toISOString(); assert.ok(Date.parse(run.sealCreatedAt) <= Date.parse(startedAt)); }
  finally { rmSync(path.dirname(run.artifactPath), {recursive: true, force: true}); }
});
test('public PASS with missing holdout cannot be accepted', () => assert.equal(decideFinal({publicPass: true, holdoutStatus: 'UNAVAILABLE'}), 'INCONCLUSIVE'));
test('invalid holdout seal cannot be accepted', () => assert.equal(decideFinal({publicPass: true, holdoutStatus: 'INVALID', holdoutPass: true}), 'INCONCLUSIVE'));
test('holdout execution error is inconclusive', () => assert.equal(decideFinal({publicPass: true, holdoutStatus: 'EXECUTED', operationalError: true, holdoutPass: true}), 'INCONCLUSIVE'));
test('candidate-reported holdout pass has no decision authority', () => assert.equal(decideFinal({publicPass: true, holdoutStatus: 'UNAVAILABLE', candidateReported: 'PASS'} as any), 'INCONCLUSIVE'));
test('a required public failure rejects without running the holdout', () => assert.equal(decideFinal({publicPass: false, holdoutStatus: 'UNAVAILABLE'}), 'REJECTED'));
test('an executed public failure is rejected', () => assert.equal(decideFinal({publicPass: false, holdoutStatus: 'EXECUTED', holdoutPass: true}), 'REJECTED'));
test('a sealed holdout failure is rejected', () => assert.equal(decideFinal({publicPass: true, holdoutStatus: 'EXECUTED', holdoutPass: false}), 'REJECTED'));
test('all deterministic gates can accept', () => assert.equal(decideFinal({publicPass: true, holdoutStatus: 'EXECUTED', holdoutPass: true}), 'ACCEPTED'));
test('receipt v2 is not accepted by the v4 verifier', () => assert.equal(verifyP04Receipt({receiptVersion: 2}, process.cwd()), false));
test('receipt v4 verifies its evidence and P03 chain without temporary annex bytes', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cat-p04-receipt-'));
  try {
    const {receipt, root, p03ReceiptPath} = validP04Fixture(dir);
    const p03Receipt = JSON.parse(readFileSync(path.join(root, p03ReceiptPath), 'utf8'));
    const p03Result = verifyP03ReceiptDetailed(p03Receipt, root);
    assert.equal(p03Result.overall, 'VERIFIED', JSON.stringify(p03Result));
    assert.equal(verifyP04Receipt(receipt, root), true);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
test('receipt v4 fails if a P03 durable artifact changes after issuance', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cat-p04-receipt-'));
  try {
    const {receipt, root, p03ReceiptPath, p03Store} = validP04Fixture(dir);
    const receiptPath = path.join(root, p03ReceiptPath);
    const receiptBytes = readFileSync(receiptPath);
    const p03Receipt = JSON.parse(receiptBytes.toString('utf8'));
    const row = p03Receipt.artifactManifest.artifacts.find((item: any) => item.workspaceLocator === null);
    const durablePath = path.join(p03Store, row.sha256);
    const original = readFileSync(durablePath);
    const changed = Buffer.from(original);
    changed[0] ^= 1;
    try {
      writeFileSync(durablePath, changed);
      assert.equal(readFileSync(receiptPath).equals(receiptBytes), true);
      assert.equal(verifyP04Receipt(receipt, root), false);
    } finally { writeFileSync(durablePath, original); }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
test('receipt v4 detects evidence artifact mutation', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cat-p04-receipt-'));
  try {
    const {receipt, annexBytes, root} = validP04Fixture(dir);
    writeFileSync(path.join(root, CASE_REL, 'contract-v3.json'), 'changed evidence');
    assert.equal(verifyP04Receipt(receipt, root, annexBytes), false);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
test('receipt v4 rejects a rehashed incomplete job and altered reason codes', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cat-p04-receipt-'));
  try {
    const {receipt, annexBytes, root} = validP04Fixture(dir);
    const forged = finalizeReceipt({...receipt, candidate: {...receipt.candidate, jobStatus: 'INCONCLUSIVE', reasonCodes: ['NO_EVIDENCE']}} as any);
    assert.equal(verifyP04Receipt(forged, root, annexBytes), false);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
test('receipt v4 rejects a rehashed private evidence identifier mismatch', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cat-p04-receipt-'));
  try {
    const {receipt, annexBytes, root} = validP04Fixture(dir);
    const forged = finalizeReceipt({...receipt, privateEvidenceId: 'cat-p04-verifier-00000000-0000-4000-8000-000000000000'} as any);
    assert.equal(verifyP04Receipt(forged, root, annexBytes), false);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
test('receipt v4 rejects implementation paths remapped to another artifact', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cat-p04-receipt-'));
  try {
    const {receipt, annexBytes, root} = validP04Fixture(dir);
    const forged = structuredClone(receipt) as any;
    const packageHash = forged.artifactHashes['implementation-package-manifest'];
    for (const id of Object.keys(forged.implementationHashes)) {
      forged.artifactPaths['implementation-' + id] = 'package.json';
      forged.artifactHashes['implementation-' + id] = packageHash;
      forged.implementationHashes[id] = packageHash;
    }
    const rehashed = finalizeReceipt(forged);
    assert.equal(verifyP04Receipt(rehashed, root, annexBytes), false);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
test('receipt v4 rejects a fabricated or incomplete runtime dependency closure', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cat-p04-receipt-'));
  try {
    const {receipt, annexBytes, root} = validP04Fixture(dir);
    const forged = structuredClone(receipt) as any;
    for (const id of Object.keys(forged.artifactPaths)) if (id.startsWith('runtime-dependency-')) {
      delete forged.artifactPaths[id]; delete forged.artifactHashes[id];
    }
    const fakeRow = {path: 'lodash/does-not-exist.js', sha256: forged.artifactHashes['implementation-package-manifest']};
    forged.runtimeDependencyManifest = [fakeRow];
    forged.runtimeDependencyTreeHash = digest(canonical(forged.runtimeDependencyManifest));
    forged.artifactPaths['runtime-dependency-lodash-does-not-exist.js'] = 'package.json';
    forged.artifactHashes['runtime-dependency-lodash-does-not-exist.js'] = fakeRow.sha256;
    assert.equal(verifyP04Receipt(finalizeReceipt(forged), root, annexBytes), false);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
test('timed-out container cleanup confirms the exact name disappeared', () => {
  const calls: string[][] = [];
  assert.throws(() => stopTimedOutContainer('cat-p04-test-id', (args) => {
    calls.push(args);
    return args[0] === 'kill' ? {status: 0, stdout: 'cat-p04-test-id'} : {status: 0, stdout: 'container-id'};
  }), /CONTAINER_TERMINATION_UNVERIFIED/);
  assert.deepEqual(calls, [['kill', 'cat-p04-test-id'], ['ps', '-aq', '--filter', 'name=^/cat-p04-test-id$']]);
});
test('receipt v4 detects a mutated receipt field', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cat-p04-receipt-'));
  try {
    const {receipt, annexBytes, root} = validP04Fixture(dir);
    const forged = finalizeReceipt({...receipt, decisions: {...receipt.decisions, s2: 'ACCEPTED'}} as any);
    assert.equal(verifyP04Receipt(forged, root, annexBytes), false);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
test('receipt v4 rejects private seed fields', () => {
  const r = {receiptVersion: 3, privateSeed: 'must-not-be-recorded'};
  assert.equal(verifyP04Receipt(r, process.cwd()), false);
});
test('P04 contract adds sourced positive-expiry preservation without changing P03 v2', () => {
  const oldBytes = readFileSync(new URL('../fixtures/hero/node-cache-ttl-zero-001/contract.json', import.meta.url));
  const contract = JSON.parse(readFileSync(new URL('../fixtures/hero/node-cache-ttl-zero-001/contract-v3.json', import.meta.url), 'utf8'));
  const source4 = readFileSync(new URL('../fixtures/hero/node-cache-ttl-zero-001/upstream/4.0.0/_src/lib/node_cache.coffee', import.meta.url), 'utf8');
  const source3 = readFileSync(new URL('../fixtures/hero/node-cache-ttl-zero-001/upstream/3.2.1/_src/lib/node_cache.coffee', import.meta.url), 'utf8');
  assert.equal(JSON.parse(oldBytes.toString()).version, 2);
  assert.equal(contract.version, 3);
  assert.ok(contract.clauses.MUST_PRESERVE.some((clause) => clause.id === 'positive-ttl-refresh-remains-finite'));
  assert.match(source3, /if ttl > 0/);
  assert.match(source4, /if ttl >= 0/);
  assert.match(source3, /now \+ \( ttl \* ttlMultiplicator \)/);
  assert.match(source4, /now \+ \( ttl \* ttlMultiplicator \)/);
});
