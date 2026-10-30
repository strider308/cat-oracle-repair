import {createHash, randomUUID} from 'node:crypto';
import {lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {finalizeReceipt} from '../core/receipt.ts';
import {canonical} from '../oracle/canonical.ts';
import {runP03Hero, runP03TargetLifecycle, verifyP03ReceiptDetailed} from './p03-runner.ts';
import {P03_SUBJECT_RECEIPT_KIND, P03_SUBJECT_RECEIPT_VERSION, verifyP03SubjectReceipt} from './p03-subject-receipt.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CASE_ROOT = path.join(ROOT, 'fixtures/hero/node-cache-ttl-zero-001');
const CASE_ID = 'node-cache-ttl-zero-001';
const IMAGE = 'sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32';
export const P03_SUBJECT_EXECUTION_INFRASTRUCTURE = Object.freeze({
  class: 'LOCAL_CONTAINER_EXECUTION_BOUNDARY',
  adapterPath: 'src/evaluation/p03-subject-adapter.cjs',
  containerImageDigest: IMAGE,
  networkProfile: 'none',
  mountProfile: Object.freeze({subjectTarget: '/subject', subjectReadOnly: true, adapterTarget: '/subject-adapter.cjs',
    adapterReadOnly: true, tmpfsTarget: '/tmp', tmpfsOptions: 'rw,noexec,nosuid,size=32m'}),
  containerUser: '10001:10001',
  readOnlyRoot: true,
  capabilities: 'ALL',
  noNewPrivileges: true,
  resourceLimits: Object.freeze({pids: 64, memory: '256m', cpus: 1}),
});
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const artifactHash = (rows: unknown) => digest(canonical(rows));
const forbiddenPathParts = new Set(['.gortex', '.git', '.agent-runs']);

function checkRelative(value: unknown, code: string) {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) ||
      value.split('/').some((part) => !part || part === '.' || part === '..' || forbiddenPathParts.has(part.toLowerCase()))) throw new Error(code);
  return value;
}
function checkNoLinks(base: string, target: string) {
  const rel = path.relative(base, target);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('SUBJECT_PATH_ESCAPE');
  let current = base;
  for (const segment of rel.split(path.sep)) {
    current = path.join(current, segment);
    let stat;
    try { stat = lstatSync(current); }
    catch (error: any) { if (error?.code === 'ENOENT') throw new Error('SUBJECT_FILE_MISSING'); throw error; }
    if (stat.isSymbolicLink()) throw new Error('SUBJECT_SYMLINK_REJECTED');
  }
  return current;
}

export function validateExternalSubjectManifest(manifest: any, root = ROOT) {
  const keys = ['candidateHash', 'candidateId', 'candidateRoot', 'caseId', 'entrypoint', 'files', 'version'];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || canonical(Object.keys(manifest).sort()) !== canonical(keys)) throw new Error('SUBJECT_MANIFEST_SCHEMA_INVALID');
  if (manifest.version !== 1 || manifest.caseId !== CASE_ID) throw new Error('SUBJECT_CASE_UNSUPPORTED');
  if (typeof manifest.candidateId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(manifest.candidateId) ||
      ['wrong', 'good', 'equivalent', 'survivor'].includes(manifest.candidateId)) throw new Error('SUBJECT_ID_INVALID');
  const candidateRootRel = checkRelative(manifest.candidateRoot, 'SUBJECT_PATH_INVALID');
  const caseReal = path.resolve(root, 'fixtures/hero', CASE_ID);
  const candidateRoot = path.resolve(root, candidateRootRel);
  const rootRel = path.relative(caseReal, candidateRoot);
  if (!rootRel || rootRel === '..' || rootRel.startsWith('..' + path.sep) || path.isAbsolute(rootRel)) throw new Error('SUBJECT_PATH_ESCAPE');
  const rootReal = checkNoLinks(caseReal, candidateRoot);
  if (!lstatSync(rootReal).isDirectory()) throw new Error('SUBJECT_ROOT_TYPE_REJECTED');
  const entrypoint = checkRelative(manifest.entrypoint, 'SUBJECT_ENTRYPOINT_INVALID');
  if (!entrypoint.endsWith('.js')) throw new Error('SUBJECT_ENTRYPOINT_INVALID');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 512) throw new Error('SUBJECT_FILES_INVALID');
  const seen = new Set();
  const fileBytes = new Map<string, Buffer>();
  let totalBytes = 0;
  const runtimeRows = manifest.files.map((row: any) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || canonical(Object.keys(row).sort()) !== canonical(['path', 'sha256']) ||
        typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error('SUBJECT_FILE_ROW_INVALID');
    const relative = checkRelative(row.path, 'SUBJECT_PATH_INVALID');
    if (!/\.(?:js|json)$/.test(relative)) throw new Error('SUBJECT_FILE_TYPE_REJECTED');
    const duplicateKey = process.platform === 'win32' ? relative.toLowerCase() : relative;
    if (seen.has(duplicateKey)) throw new Error('SUBJECT_DUPLICATE_PATH');
    seen.add(duplicateKey);
    const target = path.resolve(rootReal, ...relative.split('/'));
    const targetRel = path.relative(rootReal, target);
    if (!targetRel || targetRel === '..' || targetRel.startsWith('..' + path.sep) || path.isAbsolute(targetRel)) throw new Error('SUBJECT_PATH_ESCAPE');
    checkNoLinks(rootReal, target);
    const stat = lstatSync(target);
    if (!stat.isFile()) throw new Error('SUBJECT_FILE_TYPE_REJECTED');
    const bytes = readFileSync(target);
    totalBytes += bytes.length;
    if (totalBytes > 16 * 1024 * 1024) throw new Error('SUBJECT_SIZE_LIMIT');
    const sha256 = digest(bytes);
    if (sha256 !== row.sha256) throw new Error('SUBJECT_FILE_HASH_MISMATCH');
    fileBytes.set(relative, bytes);
    return {path: relative, sha256};
  }).sort((a: any, b: any) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const manifestRows = manifest.files.map(({path: filePath, sha256}: any) => ({path: filePath, sha256})).sort((a: any, b: any) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (canonical(manifestRows) !== canonical(runtimeRows)) throw new Error('SUBJECT_MANIFEST_RUNTIME_MISMATCH');
  if (!fileBytes.has(entrypoint)) throw new Error('SUBJECT_ENTRYPOINT_UNBOUND');
  const candidateHash = artifactHash(runtimeRows);
  if (manifest.candidateHash !== candidateHash) throw new Error('SUBJECT_CANDIDATE_HASH_MISMATCH');
  return {manifest, manifestSha256: digest(canonical(manifest)), candidateRoot: rootReal, runtimeRows, candidateHash, fileBytes};
}

function evaluation(observation: Record<string, unknown>, oracle: any) {
  const projection = Object.fromEntries(oracle.observes.map((key: string) => [key, observation[key]]));
  return canonical(projection) === canonical(oracle.expected) ? 'PASS' : 'FAIL';
}

async function executeSubject(stage: string, input: any, context: any) {
  const containerName = 'cat-p03-subject-' + context.operationId;
  const infrastructure = P03_SUBJECT_EXECUTION_INFRASTRUCTURE;
  const adapter = path.resolve(ROOT, infrastructure.adapterPath);
  const mount = infrastructure.mountProfile;
  const limits = infrastructure.resourceLimits;
  const args = ['create', '--pull=never', '-i', '--label', 'com.cat.p03.operation=' + context.operationId, '--name', containerName,
    '--network', infrastructure.networkProfile, ...(infrastructure.readOnlyRoot ? ['--read-only'] : []), '--pids-limit', String(limits.pids),
    '--memory', limits.memory, '--cpus', String(limits.cpus), '--user', infrastructure.containerUser,
    '--cap-drop', infrastructure.capabilities, '--security-opt', ...(infrastructure.noNewPrivileges ? ['no-new-privileges'] : []),
    '--tmpfs', mount.tmpfsTarget + ':' + mount.tmpfsOptions,
    '--mount', 'type=bind,source=' + stage + ',target=' + mount.subjectTarget + (mount.subjectReadOnly ? ',readonly' : ''),
    '--mount', 'type=bind,source=' + adapter + ',target=' + mount.adapterTarget + (mount.adapterReadOnly ? ',readonly' : ''),
    infrastructure.containerImageDigest, 'node', mount.adapterTarget, mount.subjectTarget];
  const capture = await runP03TargetLifecycle(args, JSON.stringify(input), {...context, containerName});
  if (capture.diagnostic.reason) {
    const boundaryUnresolved = [capture.diagnostic.stdoutTail, capture.diagnostic.stderrTail].some((text: string) => text.includes('SUBJECT_RUNTIME_BOUNDARY_UNRESOLVED'));
    throw Object.assign(new Error(boundaryUnresolved ? 'SUBJECT_RUNTIME_BOUNDARY_UNRESOLVED' : 'SUBJECT_EXECUTION_FAILED'),
      {code: boundaryUnresolved ? 'SUBJECT_RUNTIME_BOUNDARY_UNRESOLVED' : capture.diagnostic.reason, diagnostics: capture.diagnostic});
  }
  return JSON.parse(capture.stdout.toString('utf8'));
}

function failedReceipt(subject: any, reasonCode: string, calibration: any = null) {
  const oracleV1Sha256 = digest(readFileSync(path.join(CASE_ROOT, 'oracle-v1.json')));
  const oracleV2Sha256 = digest(readFileSync(path.join(CASE_ROOT, 'oracle-v2.json')));
  const runId = randomUUID();
  const receiptPath = `evidence/p03-subject-receipts/${runId}.json`;
  const receipt = finalizeReceipt({receiptVersion: P03_SUBJECT_RECEIPT_VERSION, receiptKind: P03_SUBJECT_RECEIPT_KIND,
    runId, createdAt: new Date().toISOString(), caseId: CASE_ID, receiptPath,
    calibration: calibration || {status: 'UNCALIBRATED', p03ReceiptPath: null, p03ReceiptHash: null, oracleV1Sha256, oracleV2Sha256,
      suiteEvidenceSha256: null, evidenceSha256: null, controls: null},
    subject: {candidateId: subject.manifest.candidateId, candidateHash: subject.candidateHash, candidateRoot: subject.manifest.candidateRoot,
      manifest: subject.manifest, manifestSha256: subject.manifestSha256, runtimeRows: subject.runtimeRows, reproducibilityStatus: 'NOT_RUN',
      rawObservationMatch: false, executionFailureCode: null, attempts: []}, jobStatus: 'INCONCLUSIVE', decision: null, reasonCodes: [reasonCode]});
  if (!verifyP03SubjectReceipt(receipt)) throw new Error('SUBJECT_RECEIPT_SELF_VERIFICATION_FAILED');
  writeSubjectReceipt(receipt);
  return receipt;
}

function writeSubjectReceipt(receipt: any) {
  const target = path.resolve(ROOT, receipt.receiptPath);
  mkdirSync(path.dirname(target), {recursive: true});
  writeFileSync(target, JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
}

export async function runP03SubjectEvaluation(manifestPath: string) {
  const manifestAbsolute = path.resolve(ROOT, manifestPath);
  const inputPathSegments = path.relative(CASE_ROOT, manifestAbsolute).split(path.sep);
  if (!inputPathSegments.length || inputPathSegments[0] === '..' || path.isAbsolute(path.relative(CASE_ROOT, manifestAbsolute)) ||
      inputPathSegments.some((part) => forbiddenPathParts.has(part.toLowerCase()))) throw new Error('SUBJECT_MANIFEST_PATH_INVALID');
  checkNoLinks(CASE_ROOT, manifestAbsolute);
  if (!lstatSync(manifestAbsolute).isFile()) throw new Error('SUBJECT_MANIFEST_TYPE_REJECTED');
  const manifestBytes = readFileSync(manifestAbsolute);
  const subject = validateExternalSubjectManifest(JSON.parse(manifestBytes.toString('utf8')));
  const oracleV1Bytes = readFileSync(path.join(CASE_ROOT, 'oracle-v1.json'));
  const oracleV2Bytes = readFileSync(path.join(CASE_ROOT, 'oracle-v2.json'));
  const v1 = JSON.parse(oracleV1Bytes.toString('utf8'));
  const v2 = JSON.parse(oracleV2Bytes.toString('utf8'));
  let hero: any;
  try { hero = await runP03Hero(); }
  catch { return failedReceipt(subject, 'CALIBRATION_NOT_CALIBRATED'); }
  const p03Receipt = JSON.parse(readFileSync(path.resolve(ROOT, hero.receiptPath), 'utf8'));
  const p03Verification = verifyP03ReceiptDetailed(p03Receipt, ROOT);
  if (hero.oracleStatus !== 'CALIBRATED' || hero.v1Hash !== digest(oracleV1Bytes) || hero.v2Hash !== digest(oracleV2Bytes) ||
      p03Verification.overall !== 'VERIFIED' || p03Receipt.candidate?.decision !== 'REJECTED') return failedReceipt(subject, 'CALIBRATION_NOT_CALIBRATED');
  const controls = ['wrong', 'good', 'equivalent', 'survivor'].map((candidateId) => ({candidateId,
    candidateHash: hero.candidates[candidateId].candidateSha, v1Result: hero.v1Results[candidateId], v2Result: hero.v2Results[candidateId]}));
  const calibration = {status: 'CALIBRATED', p03ReceiptPath: hero.receiptPath, p03ReceiptHash: p03Receipt.receiptHash,
    oracleV1Sha256: hero.v1Hash, oracleV2Sha256: hero.v2Hash, suiteEvidenceSha256: hero.suiteEvidenceHash, controls,
    evidenceSha256: digest(canonical({caseId: CASE_ID, p03ReceiptHash: p03Receipt.receiptHash, suiteEvidenceSha256: hero.suiteEvidenceHash,
      oracleV1Sha256: hero.v1Hash, oracleV2Sha256: hero.v2Hash, controls}))};
  const stage = mkdtempSync(path.join(os.tmpdir(), 'cat-p03-subject-'));
  const attempts: any[] = [];
  let operationalFailure = false;
  let operationalFailureCode: string | null = null;
  try {
    for (const row of subject.runtimeRows) {
      const target = path.join(stage, ...row.path.split('/'));
      mkdirSync(path.dirname(target), {recursive: true});
      writeFileSync(target, subject.fileBytes.get(row.path), {flag: 'wx'});
    }
    for (let index = 1; index <= 2; index++) {
      const operationId = randomUUID();
      const context = {logicalOperationId: `${randomUUID()}:${subject.manifest.candidateId}:P03_V2`, operationId,
        attemptId: `run-${index}`, candidateId: subject.manifest.candidateId, candidateKind: 'external-subject', oracleVersion: 'V1+V2',
        challengeId: CASE_ID, candidateArtifactSha256: subject.candidateHash};
      try {
        const result = await executeSubject(stage, {entrypoint: subject.manifest.entrypoint, input: JSON.parse(readFileSync(path.join(CASE_ROOT, 'witness.json'), 'utf8')).input,
          runtimeRows: subject.runtimeRows}, context);
        if (!result || canonical(Object.keys(result).sort()) !== canonical(['observation', 'runtimeFileCount', 'runtimeHash']) ||
            result.runtimeHash !== subject.candidateHash || result.runtimeFileCount !== subject.runtimeRows.length || !result.observation ||
            canonical(Object.keys(result.observation).sort()) !== canonical(['expiresAt', 'found', 'ttlReturned', 'value'])) throw new Error('SUBJECT_PROTOCOL_INVALID');
        attempts.push({runtimeHash: result.runtimeHash, observation: result.observation,
          observationSha256: digest(canonical(result.observation)), v1Result: evaluation(result.observation, v1), v2Result: evaluation(result.observation, v2)});
      } catch (error: any) {
        if (error?.code === 'SUBJECT_RUNTIME_BOUNDARY_UNRESOLVED' || error?.message === 'SUBJECT_RUNTIME_BOUNDARY_UNRESOLVED') throw error;
        operationalFailure = true;
        operationalFailureCode = typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'SUBJECT_EXECUTION_FAILED';
        break;
      }
    }
  } finally { rmSync(stage, {recursive: true, force: true}); }
  const stable = !operationalFailure && attempts.length === 2 && attempts.every((attempt) => attempt.runtimeHash === subject.candidateHash) && attempts[0].v2Result === attempts[1].v2Result;
  const decision = stable ? attempts[0].v2Result === 'PASS' ? 'ACCEPTED' : 'REJECTED' : null;
  const runId = randomUUID();
  const receipt = finalizeReceipt({receiptVersion: P03_SUBJECT_RECEIPT_VERSION, receiptKind: P03_SUBJECT_RECEIPT_KIND,
    runId, createdAt: new Date().toISOString(), caseId: CASE_ID,
    receiptPath: `evidence/p03-subject-receipts/${runId}.json`, calibration,
    subject: {candidateId: subject.manifest.candidateId, candidateHash: subject.candidateHash, candidateRoot: subject.manifest.candidateRoot,
      manifest: subject.manifest, manifestSha256: subject.manifestSha256, runtimeRows: subject.runtimeRows,
      reproducibilityStatus: stable ? 'REPRODUCIBLE' : operationalFailure ? 'FAILED' : attempts.length === 2 ? 'FAILED' : 'NOT_RUN',
      rawObservationMatch: attempts.length === 2 && canonical(attempts[0].observation) === canonical(attempts[1].observation),
      executionFailureCode: operationalFailureCode, attempts},
    jobStatus: stable ? 'COMPLETED' : 'INCONCLUSIVE', decision,
    reasonCodes: stable ? [decision === 'ACCEPTED' ? 'SUBJECT_V2_PASS' : 'SUBJECT_V2_FAIL'] :
      [operationalFailure ? 'SUBJECT_EXECUTION_FAILED' : 'SUBJECT_NOT_REPRODUCIBLE']});
  if (!verifyP03SubjectReceipt(receipt)) throw new Error('SUBJECT_RECEIPT_SELF_VERIFICATION_FAILED');
  writeSubjectReceipt(receipt);
  return receipt;
}

