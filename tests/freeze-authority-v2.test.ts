import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CONTROL_PATHS, generateControlledCandidate, inventoryExecutableClosure} from '../src/benchmark/controlled-candidate-generator.ts';
import {FREEZE_V2_ENTRYPOINTS, FREEZE_V2_PATHS, FREEZE_V2_SUPPORT_PATHS, inventoryExecutableClosureAtCommit,
  assertNoSymlinkedAncestors, loadFrozenControlsV2, prepareFreezeAuthorityV2} from '../src/benchmark/freeze-authority-v2.ts';
import {canonical} from '../src/oracle/canonical.ts';
import {assertControlledCandidateLifecycle, assertGenerationAuthority, CANDIDATE_ARTIFACT_COMMIT, GENERATION_AUTHORITY_COMMIT} from './controlled-candidate-lifecycle.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function candidateTreeFingerprint(candidateRoot: string): string {
  const rootStat = lstatSync(candidateRoot, {throwIfNoEntry: false});
  if (!rootStat) return 'ABSENT';
  if (rootStat.isSymbolicLink()) throw new Error('Candidate inventory root must not be a symlink');
  if (!rootStat.isDirectory()) throw new Error('Candidate inventory root must be a directory');
  const rows: {path: string; size: number; sha256: string}[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const filePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Candidate inventory does not allow symlinks: ${filePath}`);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile()) {
        const bytes = readFileSync(filePath);
        rows.push({path: path.relative(candidateRoot, filePath).split(path.sep).join('/'), size: bytes.length, sha256: sha256(bytes)});
      } else throw new Error(`Candidate inventory found a non-regular entry: ${filePath}`);
    }
  };
  visit(candidateRoot);
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  // CandidateTreeFingerprintV1 hashes sorted {path, size, sha256} rows with repository canonical JSON.
  return sha256(canonical(rows));
}
function removeTempRepo(repoPath: string) {
  if (process.platform === 'win32') {
    const quoted = repoPath.replaceAll("'", "''");
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `for ($i=0; $i -lt 30 -and (Test-Path -LiteralPath '${quoted}'); $i++) { try { Remove-Item -LiteralPath '${quoted}' -Recurse -Force -ErrorAction Stop } catch { Start-Sleep -Milliseconds 250 } }; if (Test-Path -LiteralPath '${quoted}') { exit 1 }`], {stdio: 'ignore'});
  } else rmSync(repoPath, {recursive: true, force: true, maxRetries: 80, retryDelay: 250});
}
function git(repo: string, args: string[], encoding: BufferEncoding = 'utf8') {
  return execFileSync('git', ['-C', repo, ...args], {encoding, stdio: ['ignore', 'pipe', 'pipe']}) as string;
}
function gitInput(repo: string, args: string[], input: string | Buffer) {
  return execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe']}) as string;
}
function fixture(options: {crlf?: boolean} = {}) {
  const repoRoot = mkdtempSync(path.join(root, '.tmp-cat-freeze-v2-test-'));
  const put = (relative: string, value: string | Buffer) => {
    const target = path.join(repoRoot, ...relative.split('/'));
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const source = bytes.includes(0) ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
    mkdirSync(path.dirname(target), {recursive: true}); writeFileSync(target, source);
  };
  const sourcePaths = new Set(inventoryExecutableClosure(root, FREEZE_V2_ENTRYPOINTS).map((row) => row.path));
  const supportPaths = FREEZE_V2_SUPPORT_PATHS.filter((filePath) => filePath !== FREEZE_V2_PATHS.preCandidateFreeze && filePath !== FREEZE_V2_PATHS.executableClosure);
  for (const filePath of [...new Set([...sourcePaths, ...supportPaths])]) put(filePath, readFileSync(path.join(root, ...filePath.split('/'))));
  if (options.crlf) {
    const attributesPath = path.join(repoRoot, FREEZE_V2_PATHS.attributes);
    writeFileSync(attributesPath, Buffer.concat([readFileSync(attributesPath), Buffer.from('\nsrc/benchmark/*.ts text eol=crlf\n')]));
  }
  git(repoRoot, ['init', '--quiet']);
  git(repoRoot, ['config', 'user.name', 'CAT Synthetic Freeze']);
  git(repoRoot, ['config', 'user.email', 'cat-freeze@example.invalid']);
  git(repoRoot, ['config', 'core.autocrlf', 'false']);
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '--quiet', '-m', 'synthetic base']);
  const baseSha = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  const allowlist = [...new Set([...sourcePaths, ...supportPaths])];
  const prepared = prepareFreezeAuthorityV2(repoRoot, baseSha, allowlist);
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '--quiet', '-m', 'synthetic V2 freeze']);
  const freezeCommitSha = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  return {repoRoot, baseSha, freezeCommitSha, prepared, cleanup: () => removeTempRepo(repoRoot)};
}

test('candidate fingerprint rejects linked candidate root before traversal', (t) => {
  const temp = mkdtempSync(path.join(root, '.tmp-cat-candidate-root-link-test-'));
  try {
    const target = path.join(temp, 'real-target'), linkedRoot = path.join(temp, 'candidate-link');
    mkdirSync(target);
    writeFileSync(path.join(target, 'file.txt'), 'contents');
    if (process.platform === 'win32') {
      const quotedTarget = target.replaceAll("'", "''"), quotedLink = linkedRoot.replaceAll("'", "''");
      try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `New-Item -ItemType Junction -Path '${quotedLink}' -Target '${quotedTarget}' | Out-Null`], {stdio: 'ignore'}); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return t.skip('junction creation unavailable: EPERM'); throw error; }
    } else symlinkSync(target, linkedRoot, 'dir');
    assert.throws(() => candidateTreeFingerprint(linkedRoot), /Candidate inventory root must not be a symlink/);
  } finally { removeTempRepo(temp); }
});

test('positive synthetic V2 authority loads from its full SHA with LF checkout and keeps the future tree self-contained', () => {
  const realIndexEntriesBefore = git(root, ['ls-files', '--stage', '-v', '-z']);
  const f = fixture();
  try {
    assert.match(f.freezeCommitSha, /^[a-f0-9]{40}$/);
    const controls = loadFrozenControlsV2(f.repoRoot, f.freezeCommitSha);
    assert.equal(controls.manifest.manifestVersion, 'PreCandidateFreezeV2');
    assert.equal(controls.manifest.futureAnchor, 'freezeCommitSha');
    assert.ok(!readFileSync(path.join(f.repoRoot, 'src/benchmark/freeze-authority-v2.ts')).includes(Buffer.from('\r\n')));
    assert.equal(controls.manifest.successorFreezeCommitSha, undefined);
    assert.equal(f.prepared.realIndexChanged, false);
    assert.match(f.prepared.futureTreeSha, /^[a-f0-9]{40}$/);
    assert.ok(f.prepared.exactCommitPaths.includes(FREEZE_V2_PATHS.preCandidateFreeze));
    assert.equal(f.prepared.preCandidateFreezeSha256, sha256(readFileSync(path.join(f.repoRoot, FREEZE_V2_PATHS.preCandidateFreeze))));
    assert.equal(git(f.repoRoot, ['rev-parse', `${f.freezeCommitSha}^{tree}`]).trim(), f.prepared.futureTreeSha);
    const rows = inventoryExecutableClosureAtCommit(f.repoRoot, f.freezeCommitSha);
    assert.equal(rows.length, JSON.parse(readFileSync(path.join(f.repoRoot, FREEZE_V2_PATHS.executableClosure), 'utf8')).rows.length);
    assert.ok(rows.every((row) => existsSync(path.join(f.repoRoot, ...row.path.split('/')))));
    assert.equal(existsSync(path.join(f.repoRoot, 'candidate/bundle')), false);
    assert.equal(existsSync(path.join(f.repoRoot, 'candidate/results')), false);
    assert.equal(realIndexEntriesBefore, git(root, ['ls-files', '--stage', '-v', '-z']));
  } finally { f.cleanup(); }
});

test('generation contract supersession record is bound and validated as successor support', () => {
  const f = fixture();
  try {
    const controls = loadFrozenControlsV2(f.repoRoot, f.freezeCommitSha);
    const recordPath = FREEZE_V2_PATHS.generationContractSupersession;
    const record = JSON.parse(controls.bytes[recordPath].toString('utf8'));
    const schema = JSON.parse(readFileSync(path.join(f.repoRoot, 'benchmark/schemas/pre-candidate-freeze-v2.schema.json'), 'utf8'));
    assert.equal(controls.manifest.artifacts[recordPath], sha256(controls.bytes[recordPath]));
    assert.ok(Object.hasOwn(controls.manifest.artifacts, FREEZE_V2_PATHS.generationEvidenceSchema));
    assert.equal(Object.hasOwn(controls.manifest.artifacts, 'benchmark/schemas/controlled-generation-evidence-v1.schema.json'), false);
    assert.ok(schema.properties.artifacts.propertyNames.enum.includes(recordPath));
    assert.ok(schema.properties.artifacts.propertyNames.enum.includes(FREEZE_V2_PATHS.generationEvidenceSchema));
    assert.equal(record.supersededFreezeCommitSha, '75f8b6ad870c3f385f793d5c77a44b3301d1cc8e');
    assert.equal(record.authorityStatus, 'VALID');
    assert.equal(record.generationStatus, 'NOT_EXECUTED');
    assert.equal(record.successorFreezeCommitSha, null);
  } finally { f.cleanup(); }
});

test('failed V1 commit is rejected by the production V2 load path without output creation', async () => {
  assert.throws(() => loadFrozenControlsV2(root, 'cd272debfde43ea3dfbdb39b16a47b97341e0218'), /FREEZE_AUTHORITY_VERSION_UNSUPPORTED/);
  const productionProfile = JSON.parse(readFileSync(path.join(root, CONTROL_PATHS.profile), 'utf8'));
  const realCandidate = path.join(root, productionProfile.candidateBundleRoot);
  const candidateStateBefore = candidateTreeFingerprint(realCandidate);
  await assert.rejects(() => generateControlledCandidate({repoRoot: root, freezeCommitSha: 'cd272debfde43ea3dfbdb39b16a47b97341e0218',
    outputDirectory: realCandidate}), /FREEZE_AUTHORITY_VERSION_UNSUPPORTED/);
  const candidateStateAfter = candidateTreeFingerprint(realCandidate);
  assert.equal(candidateStateAfter, candidateStateBefore);
  const f = fixture();
  try {
    await assert.rejects(() => generateControlledCandidate({repoRoot: f.repoRoot, freezeCommitSha: f.baseSha, outputDirectory: 'candidate/bundle'}), /FREEZE_AUTHORITY_VERSION_UNSUPPORTED/);
    assert.equal(existsSync(path.join(f.repoRoot, 'candidate/bundle')), false);
  } finally { f.cleanup(); }
});

test('candidate fingerprint uses canonical sorted inventory rows', () => {
  const temp = mkdtempSync(path.join(root, '.tmp-cat-candidate-fingerprint-test-'));
  try {
    const first = path.join(temp, 'first'), second = path.join(temp, 'second');
    for (const directory of [first, second]) mkdirSync(directory);
    const files = [
      {path: 'z.txt', bytes: Buffer.from('z')},
      {path: 'nested/a.txt', bytes: Buffer.from('alpha')},
      {path: 'middle.txt', bytes: Buffer.from('middle')},
    ];
    for (const file of files) {
      const target = path.join(first, ...file.path.split('/'));
      mkdirSync(path.dirname(target), {recursive: true});
      writeFileSync(target, file.bytes);
    }
    for (const file of [...files].reverse()) {
      const target = path.join(second, ...file.path.split('/'));
      mkdirSync(path.dirname(target), {recursive: true});
      writeFileSync(target, file.bytes);
    }
    const expectedRows = [
      {path: 'middle.txt', size: 6, sha256: sha256('middle')},
      {path: 'nested/a.txt', size: 5, sha256: sha256('alpha')},
      {path: 'z.txt', size: 1, sha256: sha256('z')},
    ];
    const expected = sha256(canonical(expectedRows));
    assert.equal(candidateTreeFingerprint(first), expected);
    assert.equal(candidateTreeFingerprint(second), expected);
  } finally { removeTempRepo(temp); }
});

test('committed graph remains authoritative and same-size same-mtime semantic mutation is rejected', () => {
  const f = fixture();
  try {
    const filePath = 'src/benchmark/freeze-authority-v2.ts';
    const committedRows = inventoryExecutableClosureAtCommit(f.repoRoot, f.freezeCommitSha);
    const original = readFileSync(path.join(f.repoRoot, filePath));
    const originalStat = statSync(path.join(f.repoRoot, filePath));
    const mutated = Buffer.from(original);
    const token = Buffer.from('FREEZE_CODE_CLOSURE_UNRESOLVED');
    const at = mutated.indexOf(token);
    assert.notEqual(at, -1);
    mutated[at] = mutated[at] === 70 ? 102 : 70;
    writeFileSync(path.join(f.repoRoot, filePath), mutated);
    utimesSync(path.join(f.repoRoot, filePath), originalStat.atime, originalStat.mtime);
    assert.equal(mutated.length, original.length);
    assert.equal(inventoryExecutableClosureAtCommit(f.repoRoot, f.freezeCommitSha).find((row) => row.path === filePath)?.commitBlobSha256,
      committedRows.find((row) => row.path === filePath)?.commitBlobSha256);
    assert.throws(() => loadFrozenControlsV2(f.repoRoot, f.freezeCommitSha), /FREEZE_(WORKTREE_MUTATION|WORKTREE_BLOB)_REJECTED/);
    writeFileSync(path.join(f.repoRoot, filePath), original);
    utimesSync(path.join(f.repoRoot, filePath), originalStat.atime, originalStat.mtime);
    loadFrozenControlsV2(f.repoRoot, f.freezeCommitSha);
  } finally { f.cleanup(); }
});

test('staged executable mutation is rejected', () => {
  const f = fixture();
  try {
    const filePath = 'src/benchmark/freeze-authority-v2.ts', target = path.join(f.repoRoot, filePath);
    const original = readFileSync(target), changed = Buffer.from(original);
    changed[changed.indexOf(Buffer.from('FREEZE_CODE_CLOSURE_UNRESOLVED'))] ^= 1;
    writeFileSync(target, changed); git(f.repoRoot, ['add', '--', filePath]);
    assert.throws(() => loadFrozenControlsV2(f.repoRoot, f.freezeCommitSha), /FREEZE_STAGED_MUTATION_REJECTED/);
    writeFileSync(target, original);
  } finally { f.cleanup(); }
});

test('custom filter and working-tree-encoding attributes fail closed before normalization', () => {
  for (const rule of ['src/**/*.ts filter=transform', 'src/**/*.ts working-tree-encoding=UTF-16']) {
    const f = fixture();
    try {
      const target = path.join(f.repoRoot, '.gitattributes'), original = readFileSync(target);
      writeFileSync(target, Buffer.concat([original, Buffer.from(`\n${rule}\n`)]));
      const expected = rule.includes('filter=') ? /FREEZE_CUSTOM_FILTER_REJECTED/ : /FREEZE_WORKING_TREE_ENCODING_REJECTED/;
      assert.throws(() => loadFrozenControlsV2(f.repoRoot, f.freezeCommitSha), expected);
      writeFileSync(target, original);
    } finally { f.cleanup(); }
  }
});

test('CRLF Git-clean checkout is accepted after Git normalization', () => {
  const f = fixture({crlf: true});
  try {
    git(f.repoRoot, ['config', 'core.autocrlf', 'true']);
    git(f.repoRoot, ['checkout-index', '--force', '--all']);
    const file = path.join(f.repoRoot, 'src/benchmark/freeze-authority-v2.ts');
    const lf = readFileSync(file, 'utf8');
    writeFileSync(file, lf.replace(/\r?\n/g, '\r\n'));
    const sample = readFileSync(file);
    assert.ok(sample.includes(Buffer.from('\r\n')));
    assert.equal(loadFrozenControlsV2(f.repoRoot, f.freezeCommitSha).freezeCommitSha, f.freezeCommitSha);
  } finally { f.cleanup(); }
});

test('CRLF worktree accepted with the frozen CRLF-to-LF policy when core.autocrlf is false', () => {
  const f = fixture();
  try {
    const file = path.join(f.repoRoot, 'src/benchmark/freeze-authority-v2.ts');
    const lf = readFileSync(file, 'utf8');
    writeFileSync(file, lf.replace(/\r?\n/g, '\r\n'));
    assert.ok(readFileSync(file).includes(Buffer.from('\r\n')));
    assert.equal(loadFrozenControlsV2(f.repoRoot, f.freezeCommitSha).freezeCommitSha, f.freezeCommitSha);
  } finally { f.cleanup(); }
});

test('committed symlink executable blob is rejected', () => {
  const repo = mkdtempSync(path.join(root, '.tmp-cat-v2-symlink-test-'));
  try {
    git(repo, ['init', '--bare', '--quiet']);
    git(repo, ['config', 'user.name', 'CAT']); git(repo, ['config', 'user.email', 'cat@example.invalid']);
    const blob = gitInput(repo, ['hash-object', '-w', '--stdin'], 'target.ts').trim();
    const srcTree = gitInput(repo, ['mktree'], `120000 blob ${blob}\troot.ts\n`).trim();
    const tree = gitInput(repo, ['mktree'], `040000 tree ${srcTree}\tsrc\n`).trim();
    const commit = gitInput(repo, ['commit-tree', tree, '-m', 'symlink authority']).trim();
    assert.throws(() => inventoryExecutableClosureAtCommit(repo, commit, ['src/root.ts']), /FREEZE_CODE_CLOSURE_UNRESOLVED/);
  } finally { removeTempRepo(repo); }
});

test('ancestor path check rejects a symlinked directory and paths outside the repository', () => {
  const base = path.join(root, '.synthetic-root'), link = path.join(base, 'linked');
  const fakeInspect = (target: string) => ({isSymbolicLink: () => target === link}) as any;
  assert.throws(() => assertNoSymlinkedAncestors(base, path.join(link, 'entry.ts'), fakeInspect), /CONTROLLED_SYMLINK_REJECTED/);
  assert.throws(() => assertNoSymlinkedAncestors(base, path.join(root, 'outside.ts'), fakeInspect), /CONTROLLED_PATH_INVALID/);
});

test('closure rows bind committed blob IDs and reject a row altered in a successor tree', () => {
  const f = fixture();
  try {
    const closurePath = path.join(f.repoRoot, FREEZE_V2_PATHS.executableClosure);
    const manifestPath = path.join(f.repoRoot, FREEZE_V2_PATHS.preCandidateFreeze);
    const closure = JSON.parse(readFileSync(closurePath, 'utf8'));
    closure.rows[0].gitBlobObjectId = '0'.repeat(40);
    const closureBytes = JSON.stringify(closure, null, 2) + '\n';
    writeFileSync(closurePath, closureBytes);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.artifacts[FREEZE_V2_PATHS.executableClosure] = sha256(closureBytes);
    manifest.executableClosureSha256 = sha256(canonical(closure.rows));
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    git(f.repoRoot, ['add', '--', FREEZE_V2_PATHS.executableClosure, FREEZE_V2_PATHS.preCandidateFreeze]);
    git(f.repoRoot, ['commit', '--quiet', '-m', 'tampered closure row']);
    const badSha = git(f.repoRoot, ['rev-parse', 'HEAD']).trim();
    assert.throws(() => loadFrozenControlsV2(f.repoRoot, badSha), /FREEZE_V2_CLOSURE_BLOB_MISMATCH/);
  } finally { f.cleanup(); }
});

test('missing and unresolved committed imports are rejected', () => {
  const repo = mkdtempSync(path.join(root, '.tmp-cat-v2-graph-test-'));
  try {
    const source = path.join(repo, 'src/root.ts'); mkdirSync(path.dirname(source), {recursive: true});
    writeFileSync(source, "import './missing.js';\n");
    git(repo, ['init', '--quiet']); git(repo, ['config', 'user.name', 'CAT']); git(repo, ['config', 'user.email', 'cat@example.invalid']);
    git(repo, ['add', '.']); git(repo, ['commit', '--quiet', '-m', 'missing import']);
    const sha = git(repo, ['rev-parse', 'HEAD']).trim();
    assert.throws(() => inventoryExecutableClosureAtCommit(repo, sha, ['src/root.ts']), /FREEZE_CODE_CLOSURE_UNRESOLVED/);
    writeFileSync(source, 'import(`./${name}.js`);\n'); git(repo, ['add', '.']); git(repo, ['commit', '--quiet', '-m', 'dynamic import']);
    const dynamicSha = git(repo, ['rev-parse', 'HEAD']).trim();
    assert.throws(() => inventoryExecutableClosureAtCommit(repo, dynamicSha, ['src/root.ts']), /FREEZE_CODE_CLOSURE_UNRESOLVED/);
    assert.throws(() => inventoryExecutableClosureAtCommit(repo, dynamicSha, ['../src/root.ts']), /FREEZE_CODE_CLOSURE_UNRESOLVED/);
  } finally { rmSync(repo, {recursive: true, force: true, maxRetries: 80, retryDelay: 250}); }
});

test('post-generation lifecycle tests bind candidate absence to generation authority and reject substitution', () => {
  const {generationEvidence} = assertControlledCandidateLifecycle(root);
  assert.equal(generationEvidence.freezeCommitSha, GENERATION_AUTHORITY_COMMIT);
  assert.notEqual(GENERATION_AUTHORITY_COMMIT, CANDIDATE_ARTIFACT_COMMIT);
  assert.throws(() => assertGenerationAuthority({...generationEvidence, freezeCommitSha: CANDIDATE_ARTIFACT_COMMIT}),
    /CONTROLLED_GENERATION_AUTHORITY_MISMATCH/);
  for (const testFile of ['tests/controlled-candidate-generator.test.ts', 'tests/controlled-subject-profile.test.ts']) {
    const source = readFileSync(path.join(root, testFile), 'utf8');
    assert.ok(source.includes('assertControlledCandidateLifecycle(root)'));
    assert.doesNotMatch(source, /`HEAD:/);
    assert.doesNotMatch(source, /existsSync\(path\.join\(root, profile\.(?:candidateBundleRoot|candidateSourceRoot|candidateRoot|reproductionSourceRoot|reproductionRuntimeRoot)\)/);
  }
});

test('matrix evidence names tests and scientific control bytes stay unchanged', () => {
  const matrix = JSON.parse(readFileSync(path.join(root, FREEZE_V2_PATHS.authorityMatrix), 'utf8'));
  assert.ok(matrix.rows.length > 0);
  assert.ok(matrix.rows.every((row: any) => {
    const [testFile, ...nameParts] = row.testEvidence.split(':');
    const testName = nameParts.join(':');
    if (!['tests/freeze-authority-v2.test.ts', 'tests/cat-trusted-freeze-runner-v2.test.ts'].includes(testFile)) return false;
    const testSource = readFileSync(path.join(root, testFile), 'utf8');
    return row.status === 'PASS' && row.implementationEvidence && testName &&
      (testSource.includes(`test('${testName}'`) || testSource.includes(`test("${testName}"`));
  }));
  for (const filePath of [CONTROL_PATHS.mutationSpec, CONTROL_PATHS.buildContract, CONTROL_PATHS.sameCandidateProtocol]) {
    const committed = execFileSync('git', ['-C', root, 'show', `HEAD:${filePath}`], {encoding: 'buffer'}) as Buffer;
    assert.ok(Buffer.from(readFileSync(path.join(root, filePath)).toString('binary').replace(/\r\n/g, '\n'), 'binary').equals(committed), `${filePath} differs from HEAD`);
  }
});
