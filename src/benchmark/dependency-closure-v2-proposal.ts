import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {inventoryDependencyV1} from './controlled-candidate-generator.ts';

export type DependencyRowV2 = {path: string; sha256: string};
export type LockedPackageRootV2 = {name: string; version: string; integrity: string};
const HASH = /^[a-f0-9]{64}$/;

function assertExpectedRows(rows: DependencyRowV2[]): void {
  if (!rows.length || rows.some((row) =>
    Object.keys(row).sort().join(',') !== 'path,sha256' || !row.path || row.path.startsWith('/') || row.path.includes('\\') ||
    row.path.split('/').some((part) => !part || part === '.' || part === '..') || /\.node$/i.test(row.path) || !HASH.test(row.sha256)) ||
    rows.some((row, index) => index > 0 && rows[index - 1].path >= row.path)) throw new Error('DEPENDENCY_CLOSURE_EXPECTED_ROWS_INVALID');
}

export function inventoryLockedPackageRootsV2(input: {
  dependencyRoot: string;
  packageLockBytes: Buffer;
  expectedPackageLockSha256: string;
  packageRoots: LockedPackageRootV2[];
}): DependencyRowV2[] {
  const dependencyRoot = lstatSync(input.dependencyRoot);
  if (dependencyRoot.isSymbolicLink() || !dependencyRoot.isDirectory()) throw new Error('DEPENDENCY_ROOT_INVALID');
  if (!HASH.test(input.expectedPackageLockSha256) || createHash('sha256').update(input.packageLockBytes).digest('hex') !== input.expectedPackageLockSha256) {
    throw new Error('DEPENDENCY_CLOSURE_LOCK_HASH_MISMATCH');
  }
  let lock: any;
  try { lock = JSON.parse(input.packageLockBytes.toString('utf8')); } catch { throw new Error('DEPENDENCY_CLOSURE_LOCK_INVALID'); }
  if (!input.packageRoots.length || input.packageRoots.some((item, index) =>
    Object.keys(item).sort().join(',') !== 'integrity,name,version' || !/^[a-z0-9][a-z0-9._-]*$/.test(item.name) ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(item.version) || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(item.integrity) ||
    index > 0 && input.packageRoots[index - 1].name >= item.name)) {
    throw new Error('DEPENDENCY_CLOSURE_ROOTS_INVALID');
  }
  const rows = input.packageRoots.flatMap(({name, version, integrity}) => {
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry || entry.version !== version || entry.integrity !== integrity ||
        !/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved ?? '') ||
        entry.dependencies && Object.keys(entry.dependencies).length) throw new Error('DEPENDENCY_CLOSURE_LOCK_PACKAGE_INVALID');
    const packageRoot = path.join(input.dependencyRoot, name);
    let metadata: any;
    try { metadata = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')); }
    catch { throw new Error('DEPENDENCY_CLOSURE_PACKAGE_METADATA_INVALID'); }
    if (metadata.name !== name || metadata.version !== entry.version) throw new Error('DEPENDENCY_CLOSURE_PACKAGE_VERSION_MISMATCH');
    return inventoryDependencyV1(packageRoot).map((row) => ({path: `${name}/${row.path}`, sha256: row.sha256}));
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return rows;
}

export function verifyDependencyClosureV2Proposal(input: {
  dependencyRoot: string;
  packageLockBytes: Buffer;
  expectedPackageLockSha256: string;
  packageRoots: string[];
  expectedRows: DependencyRowV2[];
}): DependencyRowV2[] {
  assertExpectedRows(input.expectedRows);
  const actual = inventoryLockedPackageRootsV2(input);
  if (actual.length !== input.expectedRows.length || actual.some((row, index) =>
    row.path !== input.expectedRows[index].path || row.sha256 !== input.expectedRows[index].sha256)) throw new Error('DEPENDENCY_CLOSURE_ROWS_MISMATCH');
  return actual;
}

export function verifyDependencyClosureV2Stage(stageRoot: string, expectedRows: DependencyRowV2[]): DependencyRowV2[] {
  assertExpectedRows(expectedRows);
  const rootInfo = lstatSync(stageRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('DEPENDENCY_CLOSURE_STAGE_ROOT_INVALID');
  const roots = [...new Set(expectedRows.map(({path}) => path.split('/')[0]))].sort();
  const actualRoots = readdirSync(stageRoot, {withFileTypes: true});
  if (actualRoots.some((entry) => entry.isSymbolicLink() || !entry.isDirectory()) ||
      actualRoots.map(({name}) => name).sort().join('\n') !== roots.join('\n')) throw new Error('DEPENDENCY_CLOSURE_STAGE_ROOT_SET_MISMATCH');
  const actual = inventoryDependencyV1(stageRoot);
  if (actual.length !== expectedRows.length || actual.some((row, index) =>
    row.path !== expectedRows[index].path || row.sha256 !== expectedRows[index].sha256)) throw new Error('DEPENDENCY_CLOSURE_ROWS_MISMATCH');
  return actual;
}
