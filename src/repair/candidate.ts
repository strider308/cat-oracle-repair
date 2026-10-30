import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {canonical} from '../oracle/canonical.ts';
import {normalizeProjectionPath} from './repair-projection.ts';
import type {RepairProposal} from './model-response.ts';
import {REPAIR_MODIFIABLE_PATH} from './model-response.ts';

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

function inventory(root: string) {
  const result: {path: string; sha256: string}[] = [];
  const walk = (dir: string) => {
    for (const item of readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, item.name);
      const info = lstatSync(full);
      if (info.isSymbolicLink() || item.isSymbolicLink()) throw new Error('REPAIR_CANDIDATE_LINK_REJECTED');
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) result.push({path: normalizeProjectionPath(path.relative(root, full).split(path.sep).join('/')), sha256: sha256(readFileSync(full))});
      else throw new Error('REPAIR_CANDIDATE_FILE_TYPE_REJECTED');
    }
  };
  walk(root);
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function applyRepairProposal(candidateRoot: string, proposal: RepairProposal) {
  if (proposal.path !== REPAIR_MODIFIABLE_PATH) throw new Error('REPAIR_PATH_NOT_ALLOWED');
  const before = inventory(candidateRoot);
  const rel = normalizeProjectionPath(proposal.path);
  const target = path.join(candidateRoot, ...rel.split('/'));
  const info = lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('REPAIR_TARGET_INVALID');
  const beforeHash = sha256(readFileSync(target));
  if (beforeHash !== proposal.baseSha256) throw new Error('REPAIR_BASE_HASH_MISMATCH');
  const bytes = Buffer.from(proposal.replacementText, 'utf8');
  if (!bytes.length || bytes.length > 65536 || bytes.includes(0)) throw new Error('REPAIR_REPLACEMENT_INVALID');
  writeFileSync(target, bytes, {flag: 'w', mode: 0o600});
  const after = inventory(candidateRoot);
  const changed = after.filter((row, i) => row.sha256 !== before[i]?.sha256 || row.path !== before[i]?.path).map((row) => row.path);
  if (before.length !== after.length || changed.length !== 1 || changed[0] !== rel) throw new Error('REPAIR_CHANGED_FILES_INVALID');
  return {changedPaths: changed, baseFileSha256: beforeHash, resultFileSha256: after.find((row) => row.path === rel)!.sha256,
    patchSha256: sha256(canonical({path: rel, baseFileSha256: beforeHash, resultFileSha256: after.find((row) => row.path === rel)!.sha256}))};
}
