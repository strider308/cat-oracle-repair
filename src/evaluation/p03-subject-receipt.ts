import {hashReceipt, verifyReceipt} from '../core/receipt.ts';
import {canonical} from '../oracle/canonical.ts';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyP03ReceiptDetailed} from './p03-runner.ts';

export const P03_SUBJECT_RECEIPT_VERSION = 1;
export const P03_SUBJECT_RECEIPT_KIND = 'P03_SUBJECT_EVALUATION';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CASE = 'node-cache-ttl-zero-001';
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const artifactHash = (rows: unknown) => digest(canonical(rows));

function oracle(root: string, version: 1 | 2) {
  return JSON.parse(readFileSync(path.join(root, 'fixtures/hero', CASE, `oracle-v${version}.json`), 'utf8'));
}
function matches(observation: Record<string, unknown>, definition: {observes: string[]; expected: Record<string, unknown>}) {
  const projection = Object.fromEntries(definition.observes.map((key) => [key, observation[key]]));
  return canonical(projection) === canonical(definition.expected);
}
function p03Artifact(receipt: any, id: string, root: string) {
  const row = receipt?.artifactManifest?.artifacts?.find((item: any) => item.id === id);
  if (typeof row?.sha256 !== 'string') throw new Error('P03_CALIBRATION_ARTIFACT_MISSING');
  const target = row.workspaceLocator ? path.resolve(root, row.workspaceLocator)
    : path.resolve(path.dirname(root), 'cat-p04-recovery/p03-durable-evidence/sha256', row.sha256);
  if (row.workspaceLocator) {
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('P03_CALIBRATION_ARTIFACT_PATH_INVALID');
  }
  const bytes = readFileSync(target);
  if (digest(bytes) !== row.sha256) throw new Error('P03_CALIBRATION_ARTIFACT_HASH_MISMATCH');
  return JSON.parse(bytes.toString('utf8'));
}

export function verifyP03SubjectReceipt(receipt: any, root = ROOT): boolean {
  try {
    if (!receipt || receipt.receiptKind !== P03_SUBJECT_RECEIPT_KIND || receipt.receiptVersion !== P03_SUBJECT_RECEIPT_VERSION ||
        !verifyReceipt(receipt) || receipt.receiptHash !== hashReceipt(receipt) || receipt.caseId !== CASE ||
        canonical(Object.keys(receipt).sort()) !== canonical(['calibration', 'caseId', 'createdAt', 'decision', 'jobStatus', 'receiptHash',
          'receiptKind', 'receiptPath', 'receiptVersion', 'reasonCodes', 'runId', 'subject'].sort())) return false;
    if (typeof receipt.receiptPath !== 'string' || path.isAbsolute(receipt.receiptPath) ||
        receipt.receiptPath.split(/[\\/]/).some((part: string) => part === '..' || part.toLowerCase() === '.gortex' || part.toLowerCase() === '.git' || part.toLowerCase() === '.agent-runs') ||
        path.relative(root, path.resolve(root, receipt.receiptPath)).startsWith('..' + path.sep) ||
        receipt.receiptPath !== `evidence/p03-subject-receipts/${receipt.runId}.json`) return false;
    const cal = receipt.calibration;
    const subject = receipt.subject;
    if (!cal || !subject || !/^[a-f0-9]{64}$/.test(cal.oracleV1Sha256 ?? '') || !/^[a-f0-9]{64}$/.test(cal.oracleV2Sha256 ?? '') ||
        !Array.isArray(receipt.reasonCodes) || !Array.isArray(subject.runtimeRows) ||
        canonical(Object.keys(cal).sort()) !== canonical(['controls', 'evidenceSha256', 'oracleV1Sha256', 'oracleV2Sha256', 'p03ReceiptHash', 'p03ReceiptPath', 'status', 'suiteEvidenceSha256'].sort()) ||
        canonical(Object.keys(subject).sort()) !== canonical(['attempts', 'candidateHash', 'candidateId', 'candidateRoot', 'executionFailureCode', 'manifest', 'manifestSha256', 'rawObservationMatch', 'reproducibilityStatus', 'runtimeRows'].sort()) ||
        subject.candidateHash !== artifactHash(subject.runtimeRows) || !/^[a-f0-9]{64}$/.test(subject.candidateHash) ||
        (subject.executionFailureCode !== null && (typeof subject.executionFailureCode !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(subject.executionFailureCode))) ||
        subject.runtimeRows.some((row: any, index: number) => !row || typeof row.path !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256) ||
          (index > 0 && subject.runtimeRows[index - 1].path >= row.path))) return false;
    const manifest = subject.manifest;
    if (!manifest || manifest.version !== 1 || manifest.caseId !== CASE || manifest.candidateId !== subject.candidateId ||
        manifest.candidateHash !== subject.candidateHash || subject.candidateRoot !== manifest.candidateRoot || !Array.isArray(manifest.files) ||
        canonical(Object.keys(manifest).sort()) !== canonical(['candidateHash', 'candidateId', 'candidateRoot', 'caseId', 'entrypoint', 'files', 'version'].sort()) ||
        typeof subject.candidateId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(subject.candidateId) ||
        ['wrong', 'good', 'equivalent', 'survivor'].includes(subject.candidateId) ||
        typeof manifest.candidateRoot !== 'string' || path.isAbsolute(manifest.candidateRoot) || manifest.candidateRoot.includes('\\') ||
        manifest.candidateRoot.split('/').some((part: string) => !part || part === '.' || part === '..' || ['.gortex', '.git', '.agent-runs'].includes(part.toLowerCase())) ||
        (() => { const caseRoot = path.resolve(root, 'fixtures/hero', CASE); const candidateRoot = path.resolve(root, manifest.candidateRoot); const rel = path.relative(caseRoot, candidateRoot); return !rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel); })() ||
        manifest.files.length !== subject.runtimeRows.length || artifactHash(subject.runtimeRows) !== subject.candidateHash ||
        digest(canonical(manifest)) !== subject.manifestSha256 ||
        manifest.files.some((row: any) => !row || canonical(Object.keys(row).sort()) !== canonical(['path', 'sha256']) || typeof row.path !== 'string' ||
          row.path.includes('\\') || path.isAbsolute(row.path) || row.path.split('/').some((part: string) => !part || part === '.' || part === '..' || ['.gortex', '.git', '.agent-runs'].includes(part.toLowerCase())) ||
          !/\.(?:js|json)$/.test(row.path)) ||
        canonical(manifest.files.map(({path: filePath, sha256: hash}: any) => ({path: filePath, sha256: hash})).sort((a: any, b: any) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) !== canonical(subject.runtimeRows) ||
        !subject.runtimeRows.some((row: any) => row.path === manifest.entrypoint)) return false;
    const v1 = oracle(root, 1), v2 = oracle(root, 2);
    if (cal.oracleV1Sha256 !== digest(readFileSync(path.join(root, 'fixtures/hero', CASE, 'oracle-v1.json'))) ||
        cal.oracleV2Sha256 !== digest(readFileSync(path.join(root, 'fixtures/hero', CASE, 'oracle-v2.json')))) return false;
    if (cal.status === 'CALIBRATED') {
      const receiptPath = cal.p03ReceiptPath;
      if (typeof receiptPath !== 'string' || path.isAbsolute(receiptPath) || receiptPath.split(/[\\/]/).some((part: string) => part === '..' || part.toLowerCase() === '.gortex' || part.toLowerCase() === '.git' || part.toLowerCase() === '.agent-runs')) return false;
      const p03Path = path.resolve(root, receiptPath);
      const relative = path.relative(root, p03Path);
      if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;
      const p03 = JSON.parse(readFileSync(p03Path, 'utf8'));
      if (p03.receiptHash !== cal.p03ReceiptHash || verifyP03ReceiptDetailed(p03, root).overall !== 'VERIFIED' ||
          p03.candidate?.decision !== 'REJECTED' || p03.sourceHashes?.['oracle-v1'] !== cal.oracleV1Sha256 ||
          p03.sourceHashes?.['oracle-v2'] !== cal.oracleV2Sha256 || p03.artifactHashes?.['suite-evidence'] !== cal.suiteEvidenceSha256) return false;
      const executions = p03Artifact(p03, 'candidate-executions', root);
      const controls = ['wrong', 'good', 'equivalent', 'survivor'];
      const expectedV1 = {wrong: 'FAIL', good: 'PASS', equivalent: 'PASS', survivor: 'PASS'};
      const expectedV2 = {wrong: 'FAIL', good: 'PASS', equivalent: 'PASS', survivor: 'FAIL'};
      const actual = controls.map((name) => ({candidateId: name, candidateHash: executions.candidates[name].candidateSha,
        v1Result: matches(executions.candidates[name].v1, v1) ? 'PASS' : 'FAIL',
        v2Result: matches(executions.candidates[name].v2, v2) ? 'PASS' : 'FAIL'}));
      if (canonical(actual) !== canonical(cal.controls) || canonical(Object.fromEntries(actual.map((row) => [row.candidateId, row.v1Result]))) !== canonical(expectedV1) ||
          canonical(Object.fromEntries(actual.map((row) => [row.candidateId, row.v2Result]))) !== canonical(expectedV2) ||
          cal.evidenceSha256 !== digest(canonical({caseId: CASE, p03ReceiptHash: p03.receiptHash, suiteEvidenceSha256: p03.artifactHashes['suite-evidence'],
            oracleV1Sha256: cal.oracleV1Sha256, oracleV2Sha256: cal.oracleV2Sha256, controls: actual}))) return false;
    } else if (cal.status !== 'UNCALIBRATED' || cal.p03ReceiptPath !== null || cal.p03ReceiptHash !== null || cal.evidenceSha256 !== null ||
        cal.suiteEvidenceSha256 !== null || cal.controls !== null) return false;

    if (!Array.isArray(subject.attempts) || subject.attempts.length > 2) return false;
    const attempts = subject.attempts;
    for (const attempt of attempts) {
      if (!attempt || canonical(Object.keys(attempt).sort()) !== canonical(['observation', 'observationSha256', 'runtimeHash', 'v1Result', 'v2Result'].sort()) ||
          !attempt.observation || attempt.runtimeHash !== artifactHash(subject.runtimeRows) ||
          attempt.observationSha256 !== digest(canonical(attempt.observation)) || attempt.v1Result !== (matches(attempt.observation, v1) ? 'PASS' : 'FAIL') ||
          attempt.v2Result !== (matches(attempt.observation, v2) ? 'PASS' : 'FAIL')) return false;
    }
    if (cal.status !== 'CALIBRATED') return receipt.jobStatus === 'INCONCLUSIVE' && receipt.decision === null && attempts.length === 0 &&
      subject.executionFailureCode === null && receipt.reasonCodes.length === 1 && receipt.reasonCodes[0] === 'CALIBRATION_NOT_CALIBRATED';
    const stable = attempts.length === 2 && attempts[0].runtimeHash === attempts[1].runtimeHash && attempts[0].v2Result === attempts[1].v2Result;
    const rawMatch = attempts.length === 2 && canonical(attempts[0].observation) === canonical(attempts[1].observation);
    const executionFailed = receipt.reasonCodes.includes('SUBJECT_EXECUTION_FAILED');
    if (subject.reproducibilityStatus !== (stable ? 'REPRODUCIBLE' : attempts.length === 2 || executionFailed ? 'FAILED' : 'NOT_RUN') || subject.rawObservationMatch !== rawMatch) return false;
    if (!stable && attempts.length < 2) {
      return receipt.jobStatus === 'INCONCLUSIVE' && receipt.decision === null && executionFailed &&
        subject.executionFailureCode !== null;
    }
    if (!stable) return receipt.jobStatus === 'INCONCLUSIVE' && receipt.decision === null && receipt.reasonCodes.includes('SUBJECT_NOT_REPRODUCIBLE');
    const decision = attempts[0].v2Result === 'PASS' ? 'ACCEPTED' : 'REJECTED';
    return receipt.jobStatus === 'COMPLETED' && subject.executionFailureCode === null && receipt.decision === decision &&
      receipt.reasonCodes.length === 1 && receipt.reasonCodes[0] === (decision === 'ACCEPTED' ? 'SUBJECT_V2_PASS' : 'SUBJECT_V2_FAIL');
  } catch { return false; }
}
