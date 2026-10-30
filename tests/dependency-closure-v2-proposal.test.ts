import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {canonical} from '../src/oracle/canonical.ts';
import {inventoryLockedPackageRootsV2, verifyDependencyClosureV2Proposal, verifyDependencyClosureV2Stage} from '../src/benchmark/dependency-closure-v2-proposal.ts';

const proposal = JSON.parse(readFileSync(new URL('../benchmark/protocol/candidate-f-dependency-closure-v2-proposal.json', import.meta.url), 'utf8'));
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

test('Candidate-F successor is explicitly non-authoritative and preserves historical identities', () => {
  assert.equal(proposal.authorityStatus, 'PROPOSAL_ONLY_NOT_FROZEN');
  assert.equal(proposal.executionAuthorized, false);
  assert.equal(proposal.freezeCommit, '5069680ff093695a227bf410eb3de88d99dce9e7');
  assert.equal(proposal.sourceCandidateCommit, 'cec8054ba8690172a7b53267cc985a4445b7860b');
  assert.equal(proposal.sourceCandidateHash, '80424bd379df4a836680d5ca420289c7e080a24377e61947a393f01c08d0a8c1');
  assert.equal(proposal.runtimeCandidateHash, 'fc594a965abb22c1542d7b887a8490244454d0c9ba51e16babeaeabf456e7621');
  assert.equal(proposal.packageLockSha256, '21c448532a8e400504c800df67ad246d6d9461c7883fc7e68861d3960ebc3ce8');
  assert.equal(proposal.packageRoots.map(({name}: {name: string}) => name).join(','), 'clone,lodash');
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cat-dependency-closure-v2-'));
  const packageRoots = [
    {name: 'a', version: '1.0.0', integrity: 'sha512-YQ=='},
    {name: 'b', version: '1.0.0', integrity: 'sha512-YQ=='},
  ];
  const packages: Record<string, unknown> = {};
  for (const {name, version, integrity} of packageRoots) {
    const packageDir = path.join(root, name);
    const bytes = name === 'a' ? Buffer.from('module.exports = 1;') : Buffer.from('{"ok":true}\n');
    mkdirSync(packageDir);
    writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({name, version}));
    writeFileSync(path.join(packageDir, name === 'a' ? 'index.js' : 'data.json'), bytes);
    packages[`node_modules/${name}`] = {version, resolved: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`, integrity};
  }
  const packageLockBytes = Buffer.from(JSON.stringify({lockfileVersion: 3, packages}));
  const dependencyRoot = root;
  const input = {dependencyRoot, packageLockBytes, expectedPackageLockSha256: digest(packageLockBytes), packageRoots};
  return {root, input, rows: inventoryLockedPackageRootsV2(input)};
}

test('proposed dependency closure binds the lock and each locked package byte exactly', () => {
  const f = fixture();
  try {
    assert.deepEqual(verifyDependencyClosureV2Proposal({...f.input, expectedRows: f.rows}), f.rows);
    assert.deepEqual(verifyDependencyClosureV2Stage(f.root, f.rows), f.rows);
    assert.throws(() => inventoryLockedPackageRootsV2({...f.input, expectedPackageLockSha256: '0'.repeat(64)}), /DEPENDENCY_CLOSURE_LOCK_HASH_MISMATCH/);
    assert.throws(() => verifyDependencyClosureV2Proposal({...f.input, expectedRows: [...f.rows].reverse()}), /DEPENDENCY_CLOSURE_EXPECTED_ROWS_INVALID/);
    assert.throws(() => verifyDependencyClosureV2Proposal({...f.input, expectedRows: [...f.rows, {path: 'c/extra.js', sha256: '0'.repeat(64)}]}), /DEPENDENCY_CLOSURE_ROWS_MISMATCH/);
    mkdirSync(path.join(f.root, 'extra'));
    writeFileSync(path.join(f.root, 'extra', 'module.js'), 'unlisted');
    assert.throws(() => verifyDependencyClosureV2Stage(f.root, f.rows), /DEPENDENCY_CLOSURE_STAGE_ROOT_SET_MISMATCH/);
    rmSync(path.join(f.root, 'extra'), {recursive: true, force: true});
    writeFileSync(path.join(f.root, 'a', 'index.js'), 'module.exports = 2;');
    assert.throws(() => verifyDependencyClosureV2Proposal({...f.input, expectedRows: f.rows}), /DEPENDENCY_CLOSURE_ROWS_MISMATCH/);
  } finally { rmSync(f.root, {recursive: true, force: true}); }
});

test('locked package closure rejects native add-ons, altered package versions, and symlinks', (t) => {
  const f = fixture();
  const outside = mkdtempSync(path.join(os.tmpdir(), 'cat-dependency-closure-v2-external-'));
  try {
    assert.throws(() => verifyDependencyClosureV2Proposal({...f.input, expectedRows: [...f.rows, {path: 'a/addon.node', sha256: 'a'.repeat(64)}]}), /DEPENDENCY_CLOSURE_EXPECTED_ROWS_INVALID/);
    writeFileSync(path.join(f.root, 'a', 'package.json'), '{"name":"a","version":"2.0.0"}');
    assert.throws(() => inventoryLockedPackageRootsV2(f.input), /DEPENDENCY_CLOSURE_PACKAGE_VERSION_MISMATCH/);
    writeFileSync(path.join(f.root, 'a', 'package.json'), '{"name":"a","version":"1.0.0"}');
    writeFileSync(path.join(outside, 'outside.js'), 'outside');
    try { symlinkSync(outside, path.join(f.root, 'a', 'linked'), 'junction'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('symlink creation is unavailable on this platform'); return; }
      throw error;
    }
    assert.throws(() => inventoryLockedPackageRootsV2(f.input), /DEPENDENCY_SYMLINK_REJECTED/);
  } finally {
    rmSync(f.root, {recursive: true, force: true});
    rmSync(outside, {recursive: true, force: true});
  }
});

test('Candidate-F locked roots reproduce the proposed package inventory from installed bytes', () => {
  const suite = fileURLToPath(new URL('../fixtures/hero/node-cache-ttl-zero-001/suite/', import.meta.url));
  const packageLockBytes = readFileSync(path.join(suite, 'package-lock.json'));
  const rows = inventoryLockedPackageRootsV2({dependencyRoot: path.join(suite, 'node_modules'), packageLockBytes,
    expectedPackageLockSha256: proposal.packageLockSha256, packageRoots: proposal.packageRoots});
  assert.equal(rows.length, proposal.packageFileCount);
  assert.equal(digest(canonical(rows)), proposal.packageRowsSha256);
  for (const item of proposal.packageRoots) {
    const metadata = JSON.parse(readFileSync(path.join(suite, 'node_modules', item.name, 'package.json'), 'utf8'));
    assert.equal(metadata.version, item.version);
  }
});
