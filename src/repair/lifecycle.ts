import {createHash} from 'node:crypto';
import {chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {canonical} from '../oracle/canonical.ts';
import {normalizeProjectionPath} from './repair-projection.ts';

export type RepairState = 'ready' | 'model_result' | 'applied' | 'public_evaluated' | 'candidate_frozen' | 'holdout_sealed' | 'blind_verified' | 'completed' | 'invalid';
const HASH = /^[a-f0-9]{64}$/;
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export function hashCandidateTree(root: string) {
  const rows: {path: string; sha256: string}[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      const info = lstatSync(full);
      if (entry.isSymbolicLink() || info.isSymbolicLink()) throw new Error('CANDIDATE_TREE_LINK_REJECTED');
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) rows.push({path: normalizeProjectionPath(path.relative(root, full).split(path.sep).join('/')), sha256: hash(readFileSync(full))});
      else throw new Error('CANDIDATE_TREE_FILE_TYPE_REJECTED');
    }
  };
  walk(root);
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!rows.length || new Set(rows.map((row) => row.path)).size !== rows.length) throw new Error('CANDIDATE_TREE_INVALID');
  return hash(canonical(rows));
}

function copyCandidateTree(source: string, destination: string) {
  mkdirSync(destination, {mode: 0o700});
  for (const entry of readdirSync(source, {withFileTypes: true})) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const info = lstatSync(from);
    if (entry.isSymbolicLink() || info.isSymbolicLink()) throw new Error('CANDIDATE_TREE_LINK_REJECTED');
    if (entry.isDirectory()) copyCandidateTree(from, to);
    else if (entry.isFile()) { copyFileSync(from, to); chmodSync(to, 0o400); }
    else throw new Error('CANDIDATE_TREE_FILE_TYPE_REJECTED');
  }
}

export function createTestRepairLifecycle(options: {testOnly: true; workspaceHash: string; baseCandidateHash: string; candidateRoot: string; publicOracleHash: string; now?: () => string; holdoutGenerator?: {testOnly: true; create: () => Buffer}}) {
  if (options.testOnly !== true || options.holdoutGenerator?.testOnly === false) throw new Error('TEST_ONLY_LIFECYCLE_REQUIRED');
  if (![options.workspaceHash, options.baseCandidateHash, options.publicOracleHash].every((value) => HASH.test(value))) throw new Error('LIFECYCLE_HASH_INVALID');
  const now = options.now ?? (() => new Date().toISOString());
  const holdoutGenerator = options.holdoutGenerator ?? {testOnly: true as const, create: () => Buffer.from(canonical({testOnly: true, fakeChallenge: 'public-safe-fixture'}))};
  const run: {state: RepairState; workspaceHash: string; baseCandidateHash: string; publicOracleHash: string; modelResultHash?: string; patchHash?: string; candidateHash?: string; publicGateHashes?: string[]; candidateFrozenAt?: string; holdoutSeal?: string; holdoutCreatedAt?: string; blindVerified?: boolean} = {
    state: 'ready', workspaceHash: options.workspaceHash, baseCandidateHash: options.baseCandidateHash, publicOracleHash: options.publicOracleHash,
  };
  let holdoutBytes: Buffer | undefined;
  let frozenRoot: string | undefined;
  let frozenHash: string | undefined;
  const invalidate = (reason: string): never => { run.state = 'invalid'; throw new Error(reason); };
  const requireState = (expected: RepairState) => { if (run.state !== expected) throw new Error('LIFECYCLE_INVALID_TRANSITION:' + run.state + ':' + expected); };
  const timestamp = () => {
    const value = now();
    if (!Number.isFinite(Date.parse(value))) throw new Error('LIFECYCLE_TIMESTAMP_INVALID');
    return value;
  };
  const candidateTreeHash = () => hashCandidateTree(options.candidateRoot);
  const assertFrozenIntact = () => {
    if (!frozenRoot || !frozenHash) invalidate('FROZEN_CANDIDATE_MUTATED');
    let actual: string;
    try { actual = hashCandidateTree(frozenRoot); }
    catch { invalidate('FROZEN_CANDIDATE_MUTATED'); }
    if (actual! !== frozenHash) invalidate('FROZEN_CANDIDATE_MUTATED');
  };
  return {
    snapshot: () => structuredClone(run),
    recordModelResult(input: {testOnly: true; resultHash: string; patchHash: string}) {
      requireState('ready');
      if (input.testOnly !== true || !HASH.test(input.resultHash) || !HASH.test(input.patchHash)) throw new Error('TEST_MODEL_RESULT_INVALID');
      run.modelResultHash = input.resultHash; run.patchHash = input.patchHash; run.state = 'model_result';
    },
    applyCandidate(input: {testOnly: true; candidateHash: string}) {
      requireState('model_result');
      const actual = candidateTreeHash();
      if (input.testOnly !== true || !HASH.test(input.candidateHash) || input.candidateHash === run.baseCandidateHash || input.candidateHash !== actual) throw new Error('TEST_CANDIDATE_INVALID');
      run.candidateHash = actual; run.state = 'applied';
    },
    evaluatePublic(input: {testOnly: true; gateHashes: string[]; passed: boolean}) {
      requireState('applied');
      if (input.testOnly !== true || !input.gateHashes.length || !input.gateHashes.every((value) => HASH.test(value)) || typeof input.passed !== 'boolean') throw new Error('TEST_PUBLIC_RESULT_INVALID');
      if (candidateTreeHash() !== run.candidateHash) throw new Error('CANDIDATE_CHANGED_BEFORE_FREEZE');
      run.publicGateHashes = [...new Set(input.gateHashes)].sort();
      if (!input.passed) throw new Error('PUBLIC_EVALUATION_FAILED');
      run.state = 'public_evaluated';
    },
    freezeCandidate() {
      requireState('public_evaluated');
      if (candidateTreeHash() !== run.candidateHash) invalidate('CANDIDATE_CHANGED_BEFORE_FREEZE');
      const privateRoot = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-frozen-'));
      frozenRoot = path.join(privateRoot, 'candidate');
      copyCandidateTree(options.candidateRoot, frozenRoot);
      frozenHash = hashCandidateTree(frozenRoot);
      if (frozenHash !== run.candidateHash) invalidate('CANDIDATE_CHANGED_DURING_FREEZE');
      chmodSync(frozenRoot, 0o500);
      run.candidateFrozenAt = timestamp(); run.state = 'candidate_frozen';
      return {baseCandidateHash: run.baseCandidateHash, workspaceHash: run.workspaceHash, modelResultHash: run.modelResultHash!, patchHash: run.patchHash!, candidateHash: frozenHash, publicOracleHash: run.publicOracleHash, publicGateHashes: [...run.publicGateHashes!], candidateFrozenAt: run.candidateFrozenAt};
    },
    sealHoldout() {
      requireState('candidate_frozen');
      assertFrozenIntact();
      try {
        holdoutBytes = holdoutGenerator.create();
        const text = holdoutBytes.toString('utf8');
        if (canonical(JSON.parse(text)) !== text) invalidate('TEST_HOLDOUT_NOT_CANONICAL');
        run.holdoutSeal = hash(holdoutBytes); run.holdoutCreatedAt = timestamp();
        if (Date.parse(run.holdoutCreatedAt) < Date.parse(run.candidateFrozenAt!)) invalidate('HOLDOUT_CREATED_BEFORE_FREEZE');
        run.state = 'holdout_sealed';
      } catch (error) { if (run.state !== 'invalid') run.state = 'invalid'; throw error; }
      return {holdoutSeal: run.holdoutSeal, holdoutCreatedAt: run.holdoutCreatedAt};
    },
    verifyBlind(input: {testOnly: true; evaluate: (input: {frozenCandidateRoot: string; holdoutBytes: Buffer}) => boolean}) {
      requireState('holdout_sealed');
      if (input.testOnly !== true || typeof input.evaluate !== 'function') throw new Error('TEST_BLIND_RESULT_INVALID');
      assertFrozenIntact();
      if (!holdoutBytes || hash(holdoutBytes) !== run.holdoutSeal) throw new Error('TEST_HOLDOUT_SEAL_INVALID');
      let passed: boolean;
      let evaluatorError: unknown;
      try { passed = input.evaluate({frozenCandidateRoot: frozenRoot!, holdoutBytes: Buffer.from(holdoutBytes)}); }
      catch (error) { evaluatorError = error; }
      assertFrozenIntact();
      if (evaluatorError !== undefined) invalidate('BLIND_EVALUATOR_FAILED');
      if (typeof passed! !== 'boolean') invalidate('TEST_BLIND_RESULT_INVALID');
      if (!passed!) invalidate('BLIND_VERIFICATION_FAILED');
      run.blindVerified = true; run.state = 'blind_verified';
    },
    complete() { requireState('blind_verified'); run.state = 'completed'; },
    dispose() { if (frozenRoot) rmSync(path.dirname(frozenRoot), {recursive: true, force: true}); },
  };
}
