import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {finalizeReceipt} from '../src/core/receipt.ts';
import {verifyP03Receipt} from '../src/evaluation/p03-runner.ts';
import {runP03SubjectEvaluation, validateExternalSubjectManifest} from '../src/evaluation/p03-subject.ts';
import {verifyP03SubjectReceipt} from '../src/evaluation/p03-subject-receipt.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const caseRoot = path.join(root, 'fixtures/hero/node-cache-ttl-zero-001');
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);
const artifactHash = (rows: any) => digest(canonical(rows));

function runtimeClosure(pkg: string, initialFiles: string[]) {
  const files = new Set<string>();
  const visit = (file: string) => {
    file = path.resolve(file);
    if (files.has(file)) return;
    files.add(file);
    if (!file.endsWith('.js')) return;
    const source = readFileSync(file, 'utf8');
    for (const [, request] of source.matchAll(/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)) {
      const base = path.resolve(path.dirname(file), request);
      const target = [base, base + '.js', path.join(base, 'index.js')].find((candidate) => existsSync(candidate) && !candidate.endsWith('.json'));
      if (!target) throw new Error(`Unresolved test fixture dependency: ${request}`);
      visit(target);
    }
  };
  for (const file of initialFiles) visit(path.resolve(pkg, file));
  return [...files].map((file) => ({absolute: file, relative: path.relative(pkg, file).split(path.sep).join('/')}));
}

function createControlManifest(tempRoot: string, candidateId: string, runtimeRoot: string) {
  const candidateRoot = path.join(tempRoot, candidateId);
  mkdirSync(candidateRoot, {recursive: true});
  const sourceRoot = path.join(caseRoot, runtimeRoot);
  for (const relative of ['index.js', 'lib/node_cache.js']) {
    const target = path.join(candidateRoot, relative);
    mkdirSync(path.dirname(target), {recursive: true});
    copyFileSync(path.join(sourceRoot, relative), target);
  }
  const depsRoot = path.join(caseRoot, 'suite/node_modules');
  const closure = [
    ...runtimeClosure(path.join(depsRoot, 'lodash'), ['assignIn.js', 'isArray.js', 'isString.js', 'isFunction.js', 'isNumber.js', 'isObject.js', 'size.js', 'template.js']),
    {absolute: path.join(depsRoot, 'clone/package.json'), relative: 'package.json'},
    {absolute: path.join(depsRoot, 'clone/clone.js'), relative: 'clone.js'},
  ];
  for (const file of closure) {
    const relative = file.absolute.includes(`${path.sep}lodash${path.sep}`)
      ? `node_modules/lodash/${path.relative(path.join(depsRoot, 'lodash'), file.absolute).split(path.sep).join('/')}`
      : `node_modules/clone/${path.basename(file.absolute)}`;
    const target = path.join(candidateRoot, relative);
    mkdirSync(path.dirname(target), {recursive: true});
    copyFileSync(file.absolute, target);
  }
  const files = [];
  const collect = (dir: string) => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(target);
      else {
        const relative = path.relative(candidateRoot, target).split(path.sep).join('/');
        files.push({path: relative, sha256: digest(readFileSync(target))});
      }
    }
  };
  collect(candidateRoot);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const manifest = {version: 1, caseId: 'node-cache-ttl-zero-001', candidateId,
    candidateRoot: path.relative(root, candidateRoot).split(path.sep).join('/'), entrypoint: 'index.js', files,
    candidateHash: artifactHash(files)};
  const manifestPath = path.join(tempRoot, `${candidateId}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

test('external subject manifest rejects unsafe paths and hash mismatches', (t) => {
  const tempRoot = mkdtempSync(path.join(caseRoot, 'candidates', '.subject-manifest-'));
  try {
    const candidateRoot = path.join(tempRoot, 'candidate');
    mkdirSync(candidateRoot);
    writeFileSync(path.join(candidateRoot, 'index.js'), 'module.exports = class {};');
    const bytes = readFileSync(path.join(candidateRoot, 'index.js'));
    const row = {path: 'index.js', sha256: digest(bytes)};
    const base = {version: 1, caseId: 'node-cache-ttl-zero-001', candidateId: 'subject-test',
      candidateRoot: path.relative(root, candidateRoot).split(path.sep).join('/'), entrypoint: 'index.js', files: [row], candidateHash: artifactHash([row])};
    assert.equal(validateExternalSubjectManifest(base).candidateHash, base.candidateHash);
    assert.throws(() => validateExternalSubjectManifest({...base, candidateRoot: '../.gortex'}), /SUBJECT_PATH_INVALID|SUBJECT_PATH_ESCAPE/);
    assert.throws(() => validateExternalSubjectManifest({...base, candidateRoot: path.resolve(candidateRoot)}), /SUBJECT_PATH_INVALID/);
    assert.throws(() => validateExternalSubjectManifest({...base, caseId: 'unsupported'}), /SUBJECT_CASE_UNSUPPORTED/);
    assert.throws(() => validateExternalSubjectManifest({...base, files: [{...row, sha256: '0'.repeat(64)}]}), /SUBJECT_FILE_HASH_MISMATCH/);
    assert.throws(() => validateExternalSubjectManifest({...base, candidateHash: '0'.repeat(64)}), /SUBJECT_CANDIDATE_HASH_MISMATCH/);
    assert.throws(() => validateExternalSubjectManifest({...base, files: [row, row]}), /SUBJECT_DUPLICATE_PATH/);
    assert.throws(() => validateExternalSubjectManifest({...base, files: [{...row, path: '../index.js'}]}), /SUBJECT_PATH_INVALID/);
    assert.throws(() => validateExternalSubjectManifest({...base, files: [{...row, path: 'missing.js'}]}), /SUBJECT_FILE_MISSING/);
    assert.throws(() => validateExternalSubjectManifest({...base, expectedDecision: 'ACCEPTED'}), /SUBJECT_MANIFEST_SCHEMA_INVALID/);
    try {
      const link = path.join(candidateRoot, 'link.js');
      symlinkSync(path.join(candidateRoot, 'index.js'), link);
      assert.throws(() => validateExternalSubjectManifest({...base, files: [row, {path: 'link.js', sha256: row.sha256}]}), /SUBJECT_SYMLINK_REJECTED/);
    } catch (error: any) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'ENOSYS') t.diagnostic('Symlink creation unavailable on this host; symlink rejection was not exercised.');
      else if (error?.message?.includes('SUBJECT_SYMLINK_REJECTED')) throw error;
      else throw error;
    }
  } finally { rmSync(tempRoot, {recursive: true, force: true}); }
});

test('calibrated subject evaluation derives ACCEPTED/REJECTED from frozen V2 and keeps receipt kinds separate', async () => {
  const tempRoot = mkdtempSync(path.join(caseRoot, 'candidates', '.subject-polarity-'));
  try {
    const goodPath = createControlManifest(tempRoot, 'subject-known-good', 'upstream/4.0.0');
    const wrongPath = createControlManifest(tempRoot, 'subject-known-wrong', 'suite/source');
    const good = await runP03SubjectEvaluation(goodPath);
    const wrong = await runP03SubjectEvaluation(wrongPath);
    assert.equal(good.calibration.status, 'CALIBRATED');
    assert.equal(good.subject.attempts[0].v2Result, 'PASS');
    assert.equal(good.decision, 'ACCEPTED');
    assert.equal(wrong.calibration.status, 'CALIBRATED');
    assert.equal(wrong.subject.attempts[0].v2Result, 'FAIL');
    assert.equal(wrong.decision, 'REJECTED');
    assert.equal(verifyP03SubjectReceipt(good), true);
    assert.equal(verifyP03SubjectReceipt(wrong), true);
    assert.equal(verifyP03Receipt(good), false);
    const ordinaryP03 = JSON.parse(readFileSync(path.join(root, good.calibration.p03ReceiptPath), 'utf8'));
    assert.equal(verifyP03SubjectReceipt(ordinaryP03), false);

    const operational = structuredClone(good);
    operational.subject.attempts = [];
    operational.subject.reproducibilityStatus = 'FAILED';
    operational.subject.executionFailureCode = 'CREATE_FAILURE';
    operational.subject.rawObservationMatch = false;
    operational.jobStatus = 'INCONCLUSIVE';
    operational.decision = null;
    operational.reasonCodes = ['SUBJECT_EXECUTION_FAILED'];
    assert.equal(verifyP03SubjectReceipt(finalizeReceipt(operational)), true);

    const uncalibrated = structuredClone(good);
    uncalibrated.calibration = {...uncalibrated.calibration, status: 'UNCALIBRATED', p03ReceiptPath: null,
      p03ReceiptHash: null, suiteEvidenceSha256: null, evidenceSha256: null, controls: null};
    uncalibrated.subject.attempts = [];
    uncalibrated.subject.reproducibilityStatus = 'NOT_RUN';
    uncalibrated.jobStatus = 'INCONCLUSIVE';
    uncalibrated.decision = null;
    uncalibrated.reasonCodes = ['CALIBRATION_NOT_CALIBRATED'];
    assert.equal(verifyP03SubjectReceipt(finalizeReceipt(uncalibrated)), true);

    const passAsReject = structuredClone(good);
    passAsReject.subject.attempts.forEach((attempt: any) => { attempt.v2Result = 'FAIL'; });
    assert.equal(verifyP03SubjectReceipt(finalizeReceipt(passAsReject)), false);
    const failAsAccept = structuredClone(wrong);
    failAsAccept.subject.attempts.forEach((attempt: any) => { attempt.v2Result = 'PASS'; });
    assert.equal(verifyP03SubjectReceipt(finalizeReceipt(failAsAccept)), false);
    const candidateMismatch = structuredClone(good);
    candidateMismatch.subject.candidateHash = '0'.repeat(64);
    assert.equal(verifyP03SubjectReceipt(finalizeReceipt(candidateMismatch)), false);
    const runtimeMismatch = structuredClone(good);
    runtimeMismatch.subject.manifest.files[0].sha256 = '0'.repeat(64);
    assert.equal(verifyP03SubjectReceipt(finalizeReceipt(runtimeMismatch)), false);
    const calibrationMismatch = structuredClone(good);
    calibrationMismatch.calibration.evidenceSha256 = '0'.repeat(64);
    assert.equal(verifyP03SubjectReceipt(finalizeReceipt(calibrationMismatch)), false);
    const mutated = structuredClone(good);
    mutated.decision = 'REJECTED';
    assert.equal(verifyP03SubjectReceipt(mutated), false);
  } finally { rmSync(tempRoot, {recursive: true, force: true}); }
});
