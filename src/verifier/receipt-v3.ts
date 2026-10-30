import {lstatSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {verifyReceipt} from '../core/receipt.ts';
import {canonical} from '../oracle/canonical.ts';
import {runtimeDependencyPaths} from './runtime-dependencies.ts';
import {sha256} from './sealed-verifier.ts';
import {verifyP03ReceiptDetailed, verifyP03SupersessionRecord} from '../evaluation/p03-runner.ts';

const CASE = 'fixtures/hero/node-cache-ttl-zero-001';
const HISTORICAL_P03_RECEIPT_HASH = '1271e7ed0552bc752c714e27ce61b65e79ebbc3446879e05ff158126c54f735b';
const candidates = ['equivalent', 'good', 's2', 'v3'];
const candidateDirs = {v3: 'suite/source', good: 'upstream/4.0.0', equivalent: 'candidates/equivalent', s2: 'candidates/s2-overbroad-zero-fix'};
const candidateFiles = {v3: ['index.js', 'lib/node_cache.js'], good: ['index.js', 'lib/node_cache.js'], equivalent: ['index.js'], s2: ['index.js']};
const implementationPaths = {
  'candidate-adapter': CASE + '/adapter.cjs', 'holdout-generator': 'src/verifier/holdout-generator.ts',
  'oracle-calibrate': 'src/oracle/calibrate.ts', 'oracle-canonical': 'src/oracle/canonical.ts', 'oracle-evaluate': 'src/oracle/evaluate.ts',
  'p04-runner': 'scripts/cat-sealed.ts', 'package-manifest': 'package.json', 'receipt-core': 'src/core/receipt.ts',
  'receipt-verifier': 'src/verifier/receipt-v3.ts', 'p03-replay-verifier': 'src/evaluation/p03-runner.ts', 'runtime-dependencies': 'src/verifier/runtime-dependencies.ts',
  'sealed-verifier': 'src/verifier/sealed-verifier.ts', 'docker-cleanup': 'src/verifier/docker-cleanup.ts',
};
const fixedArtifactPaths = {
  'contract-v3': CASE + '/contract-v3.json', 'public-oracle-v2': CASE + '/oracle-v2.json', 'source-records': CASE + '/sources.json',
  'source-v3-code': CASE + '/upstream/3.2.1/_src/lib/node_cache.coffee', 'source-v4-code': CASE + '/upstream/4.0.0/_src/lib/node_cache.coffee',
  'source-v4-api': CASE + '/upstream/node-cache-4.0.0-README.md', 'public-witness': CASE + '/witness.json', 'suite-lockfile': CASE + '/suite/package-lock.json',
};

function hasSeedField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSeedField);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => /seed/i.test(key) || hasSeedField(entry));
}
function holdoutPass(challenge: any, row: any) {
  const o = row?.observation;
  return !!o && Number.isFinite(row.startedAtMs) && Number.isFinite(row.finishedAtMs) &&
    o.ttlReturned === true && o.found === true && o.value === challenge.value && Number.isFinite(o.expiresAt) &&
    o.expiresAt > row.startedAtMs - 2000 && o.expiresAt <= row.finishedAtMs + challenge.updatedTtlSeconds * 1000 + 2000;
}
function sortedKeys(value: Record<string, unknown>) { return Object.keys(value).sort().join('|'); }

export function verifyP04Receipt(receipt: any, root: string, privateAnnexBytes?: Buffer) {
  try {
    const initialChecks: [string, boolean][] = [
      ['version', receipt?.receiptVersion === 4], ['receipt-hash', !!receipt && verifyReceipt(receipt)], ['seed-absence', !hasSeedField(receipt)],
      ['p03-run-id', /^[a-f0-9-]{36}$/.test(receipt?.p03ReplayRunId ?? '')],
      ['p03-current-hash', /^[a-f0-9]{64}$/.test(receipt?.p03ReplayReceiptHash ?? '')],
      ['p03-history-hash', receipt?.p03HistoricalReceiptHash === HISTORICAL_P03_RECEIPT_HASH],
      ['p03-supersession-hash', /^[a-f0-9]{64}$/.test(receipt?.p03SupersessionRecordHash ?? '')],
      ['p03-supersession-path', receipt?.p03SupersessionRecordPath === `evidence/manifests/p03-supersession-${receipt?.p03ReplayRunId}.json`],
      ['private-evidence-path', receipt?.privateEvidencePath === `evidence/sealed-private/${receipt?.runId}.json`],
      ['generator', receipt?.holdoutGeneratorVersion === 'positive-expiry-v1'], ['holdout-status', receipt?.holdoutStatus === 'EXECUTED'], ['challenge-count', receipt?.holdoutChallengeCount === 1],
      ['run-id', /^[a-f0-9-]{36}$/.test(receipt?.runId ?? '')], ['private-id', receipt?.privateEvidenceId === 'cat-p04-verifier-' + receipt?.runId],
      ['holdout-seal', /^[a-f0-9]{64}$/.test(receipt?.holdoutSeal ?? '')], ['candidate-hash', /^[a-f0-9]{64}$/.test(receipt?.candidateWorkspaceHash ?? '')],
      ['contract-hash', /^[a-f0-9]{64}$/.test(receipt?.contractHash ?? '')], ['oracle-hash', /^[a-f0-9]{64}$/.test(receipt?.publicOracleHash ?? '')],
      ['private-hash-shape', /^[a-f0-9]{64}$/.test(receipt?.privateEvidenceSha256 ?? '')], ['environment-hash', /^[a-f0-9]{64}$/.test(receipt?.environmentDigest ?? '')],
      ['timestamps', Number.isFinite(Date.parse(receipt?.sealCreatedAt)) && Number.isFinite(Date.parse(receipt?.candidateStartedAt)) && Date.parse(receipt?.sealCreatedAt) <= Date.parse(receipt?.candidateStartedAt)],
      ['artifact-maps', !!receipt?.artifactPaths && !!receipt?.artifactHashes],
      ['candidate-maps', !!receipt?.candidateWorkspaceHashes && !!receipt?.candidateProjectionManifests && receipt?.candidateWorkspaceHashes?.s2 === receipt?.candidateWorkspaceHash],
      ['job-status', receipt?.candidate?.jobStatus === 'COMPLETED'], ['candidate-binding', receipt?.candidate?.candidateSha === receipt?.candidateWorkspaceHash],
      ['contract-binding', receipt?.candidate?.contractHash === receipt?.contractHash], ['decision', receipt?.candidate?.decision === 'REJECTED'],
      ['reason-codes', canonical(receipt?.candidate?.reasonCodes) === canonical(['PUBLIC_PASS', 'SEALED_HOLDOUT_FAIL'])],
      ['adversarial-id', receipt?.adversarialCandidate?.id === 'S2-overbroad-zero-fix'], ['adversarial-provenance', receipt?.adversarialCandidate?.provenance === 'MANUAL_RESEARCH'],
      ['adversarial-binding', receipt?.adversarialCandidate?.candidateArtifactHash === receipt?.candidateWorkspaceHash], ['oracle-status', receipt?.publicOracleStatus === 'WEAK'],
      ['leakage-hash', !!receipt?.leakageEvidenceHash],
    ];
    if (initialChecks.some(([, ok]) => !ok)) return false;
    if (sortedKeys(receipt.candidateWorkspaceHashes) !== candidates.join('|') || sortedKeys(receipt.candidateProjectionManifests) !== candidates.join('|')) return false;

    const expectedArtifacts: Record<string, string> = {...fixedArtifactPaths, leakage: `evidence/sealed/${receipt.runId}-leakage.json`,
      'private-evidence': receipt.privateEvidencePath,
      'p03-current-receipt': `evidence/p03-receipts/${receipt.p03ReplayRunId}.json`, 'p03-supersession-record': receipt.p03SupersessionRecordPath};
    for (const [id, rel] of Object.entries(implementationPaths)) expectedArtifacts['implementation-' + id] = rel;
    for (const [name, files] of Object.entries(candidateFiles)) {
      const rows = receipt.candidateProjectionManifests[name];
      if (!Array.isArray(rows) || canonical(rows.map((row: any) => row.path)) !== canonical(files) ||
        rows.some((row: any) => typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) ||
        sha256(canonical(rows)) !== receipt.candidateWorkspaceHashes[name]) return false;
      for (const row of rows) expectedArtifacts['candidate-' + name + '-' + row.path.replaceAll('/', '-')] = CASE + '/' + candidateDirs[name] + '/' + row.path;
    }

    const base = path.resolve(root);
    const suiteDir = path.join(base, CASE, 'suite');
    const dependencyRows = runtimeDependencyPaths(suiteDir).map((rel) => {
      const file = path.join(suiteDir, 'node_modules', rel);
      if (lstatSync(file).isSymbolicLink()) throw new Error('RUNTIME_DEPENDENCY_SYMLINK');
      return {path: rel.split(path.sep).join('/'), sha256: sha256(readFileSync(file))};
    }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
    if (!Array.isArray(receipt.runtimeDependencyManifest) || canonical(receipt.runtimeDependencyManifest) !== canonical(dependencyRows) ||
      sha256(canonical(dependencyRows)) !== receipt.runtimeDependencyTreeHash) return false;
    for (const row of dependencyRows) expectedArtifacts['runtime-dependency-' + row.path.replaceAll('/', '-')] = CASE + '/suite/node_modules/' + row.path;
    if (canonical(Object.keys(expectedArtifacts).sort()) !== canonical(Object.keys(receipt.artifactPaths).sort()) ||
      canonical(Object.keys(expectedArtifacts).sort()) !== canonical(Object.keys(receipt.artifactHashes ?? {}).sort())) return false;
    for (const [id, expectedPath] of Object.entries(expectedArtifacts)) if (receipt.artifactPaths[id] !== expectedPath) return false;

    for (const [id, rows] of Object.entries(receipt.candidateProjectionManifests) as [string, any[]][]) {
      for (const row of rows) if (receipt.artifactHashes['candidate-' + id + '-' + row.path.replaceAll('/', '-')] !== row.sha256) return false;
    }
    const implementationIds = Object.keys(implementationPaths);
    if (canonical(Object.keys(receipt.implementationHashes ?? {}).sort()) !== canonical(implementationIds.sort()) ||
      implementationIds.some((id) => receipt.implementationHashes[id] !== receipt.artifactHashes['implementation-' + id])) return false;

    const expectedPublic = {equivalent: 'PASS', good: 'PASS', s2: 'PASS', v3: 'FAIL'};
    const expectedSealed = {equivalent: 'PASS', good: 'PASS', s2: 'FAIL', v3: 'NOT_RUN'};
    const expectedDecisions = {equivalent: 'ACCEPTED', good: 'ACCEPTED', s2: 'REJECTED', v3: 'REJECTED'};
    if (canonical(receipt.publicResults) !== canonical(expectedPublic) || canonical(receipt.sealedResults) !== canonical(expectedSealed) ||
      canonical(receipt.decisions) !== canonical(expectedDecisions) || receipt.adversarialCandidate.publicOracleOutcome !== 'PASS' ||
      receipt.adversarialCandidate.sealedOutcome !== 'FAIL' || canonical(receipt.adversarialCandidate.violatedClauseIds) !== canonical(['positive-ttl-refresh-remains-finite'])) return false;
    const expectedManifestHash = sha256(canonical({publicResults: expectedPublic, sealedResults: expectedSealed, decisions: expectedDecisions}));
    if (receipt.candidate.evidenceManifestHash !== expectedManifestHash || canonical(receipt.candidate.requiredGateIds) !== canonical(['public-v2', 'sealed-positive-expiry']) ||
      canonical(receipt.candidate.gates) !== canonical({'public-v2': 'PASS', 'sealed-positive-expiry': 'FAIL'})) return false;

    for (const [id, rel] of Object.entries(expectedArtifacts)) {
      const file = path.resolve(base, rel);
      if (!file.startsWith(base + path.sep) || lstatSync(file).isSymbolicLink() || sha256(readFileSync(file)) !== receipt.artifactHashes[id]) return false;
    }
    const annexBytes = privateAnnexBytes ?? readFileSync(path.resolve(base, expectedArtifacts['private-evidence']));
    const storedAnnexBytes = readFileSync(path.resolve(base, expectedArtifacts['private-evidence']));
    if (!annexBytes.equals(storedAnnexBytes) || sha256(annexBytes) !== receipt.privateEvidenceSha256) return false;
    const p03ReceiptBytes = readFileSync(path.resolve(base, expectedArtifacts['p03-current-receipt']));
    const p03Receipt = JSON.parse(p03ReceiptBytes.toString('utf8'));
    const supersessionBytes = readFileSync(path.resolve(base, expectedArtifacts['p03-supersession-record']));
    const supersession = JSON.parse(supersessionBytes.toString('utf8'));
    if (sha256(supersessionBytes) !== receipt.p03SupersessionRecordHash || !verifyReceipt(p03Receipt) ||
      sha256(p03ReceiptBytes) !== supersession.newReceiptFileSha256 || p03Receipt.receiptHash !== receipt.p03ReplayReceiptHash ||
      p03Receipt.receiptVersion !== 4 || p03Receipt.receiptKind !== 'P03' || p03Receipt.runId !== receipt.p03ReplayRunId ||
      p03Receipt.supersedesReceiptHash !== receipt.p03HistoricalReceiptHash || p03Receipt.historicalVerification?.overall !== 'HISTORICAL_INCOMPLETE' ||
      supersession.recordVersion !== 1 || supersession.reason !== 'HISTORICAL_ARTIFACTS_NOT_RETAINED' ||
      supersession.historicalReceiptHash !== receipt.p03HistoricalReceiptHash || supersession.newReceiptVersion !== 4 ||
      supersession.newReceiptHash !== receipt.p03ReplayReceiptHash || supersession.newReceiptPath !== expectedArtifacts['p03-current-receipt'] ||
      supersession.newReceiptDurableLocator !== 'durable://p03/sha256/' + supersession.newReceiptFileSha256 ||
      verifyP03ReceiptDetailed(p03Receipt, base).overall !== 'VERIFIED' || !verifyP03SupersessionRecord(supersession, base)) return false;
    if (receipt.sourceHashes?.contract !== receipt.contractHash || receipt.sourceHashes?.contract !== receipt.artifactHashes['contract-v3'] ||
      receipt.sourceHashes?.publicOracle !== receipt.publicOracleHash || receipt.sourceHashes?.publicOracle !== receipt.artifactHashes['public-oracle-v2'] ||
      receipt.leakageEvidenceHash !== receipt.artifactHashes.leakage) return false;
    const leakage = JSON.parse(readFileSync(path.resolve(base, expectedArtifacts.leakage), 'utf8'));
    if (leakage.result !== 'PASS' || leakage.gitMetadataAccessible !== false || leakage.privateEvaluatorAccessible !== false ||
      leakage.sensitiveEnvironmentNamesPresent !== false || leakage.outboundNetworkAccessible !== false || leakage.candidateWorkspaceHash !== receipt.candidateWorkspaceHash) return false;
    const annex = JSON.parse(annexBytes.toString('utf8'));
    if (annex.version !== 1 || annex.runId !== receipt.runId || annex.privateEvidenceId !== receipt.privateEvidenceId ||
      sha256(Buffer.from(canonical(annex.holdoutPack))) !== receipt.holdoutSeal || annex.holdoutPack.generatorVersion !== receipt.holdoutGeneratorVersion ||
      annex.holdoutPack.challenges?.length !== 1 || canonical(Object.keys(annex.evaluations).sort()) !== canonical(['equivalent', 'good', 's2'])) return false;
    for (const name of ['s2', 'good', 'equivalent']) if ((holdoutPass(annex.holdoutPack.challenges[0], annex.evaluations[name]) ? 'PASS' : 'FAIL') !== receipt.sealedResults[name]) return false;
    return true;
  } catch { return false; }
}
