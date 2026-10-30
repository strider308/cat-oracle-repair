import {createHash} from 'node:crypto';
import {chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {canonical} from '../oracle/canonical.ts';
import {normalizeProjectionPath} from './repair-projection.ts';
import {decideFinal} from '../verifier/sealed-verifier.ts';

const HASH = /^[a-f0-9]{64}$/;
const GIT_OBJECT_ID = /^[a-f0-9]{40,64}$/;
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export type RepairBackend = 'NEBIUS_SANDBOX' | 'NEBIUS_OTHER_VERIFIED_EXECUTION' | 'LOCAL_DOCKER_FALLBACK';
export type GateEvidence = {gate: string; candidateHash: string; backend: RepairBackend; command: string[]; exitCode: number; outputSha256: string; runtimeSha256: string; semantic: 'PASS' | 'FAIL' | 'ERROR' | 'NOT_RUN'; failureKind?: 'NONE' | 'SEMANTIC' | 'OPERATIONAL' | 'SKIPPED'; reasonCode?: string | null; executionEvidenceId?: string | null};
export type HoldoutInstance = {bytes: Buffer; seal: string; challengeCount: number; generatorVersion: string; seedCreatedAt: string; createdAt: string};

export function hashRepairTree(root: string) {
  const rows: {path: string; sha256: string}[] = [];
  const walk = (dir: string) => {
    for (const item of readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, item.name);
      const info = lstatSync(file);
      if (info.isSymbolicLink() || item.isSymbolicLink()) throw new Error('REPAIR_TREE_LINK_REJECTED');
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) rows.push({path: normalizeProjectionPath(path.relative(root, file).split(path.sep).join('/')), sha256: sha256(readFileSync(file))});
      else throw new Error('REPAIR_TREE_FILE_TYPE_REJECTED');
    }
  };
  walk(root);
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!rows.length || new Set(rows.map((row) => row.path)).size !== rows.length) throw new Error('REPAIR_TREE_INVALID');
  return sha256(canonical(rows));
}

function copyTree(source: string, destination: string) {
  mkdirSync(destination, {mode: 0o700});
  for (const item of readdirSync(source, {withFileTypes: true})) {
    const from = path.join(source, item.name);
    const to = path.join(destination, item.name);
    const info = lstatSync(from);
    if (info.isSymbolicLink() || item.isSymbolicLink()) throw new Error('REPAIR_TREE_LINK_REJECTED');
    if (item.isDirectory()) copyTree(from, to);
    else if (item.isFile()) { copyFileSync(from, to); chmodSync(to, 0o400); }
    else throw new Error('REPAIR_TREE_FILE_TYPE_REJECTED');
  }
  chmodSync(destination, 0o500);
}

const GATES = ['build', 'existing-suite', 'public-contract', 'public-oracle-v2'] as const;
const validEvidence = (item: GateEvidence) => GATES.includes(item.gate as typeof GATES[number]) && HASH.test(item.candidateHash) &&
  HASH.test(item.outputSha256) && HASH.test(item.runtimeSha256) && item.command.length > 0 && item.command.every((v) => typeof v === 'string') &&
  Number.isSafeInteger(item.exitCode) && ['PASS', 'FAIL', 'ERROR', 'NOT_RUN'].includes(item.semantic);

export function createRepairLifecycle(options: {
  workspaceHash: string; baseCandidateHash: string; publicOracleHash: string; implementationSha: string;
  implementationTreeSha: string; implementationFiles: {path: string; sha256: string}[];
  candidateRoot: string; backend: RepairBackend; now?: () => string;
  persistFrozen: (root: string, evidence: Record<string, unknown> & {candidateHash: string; implementationSha: string}) => string;
  createHoldout: () => HoldoutInstance;
  persistHoldout: (holdout: HoldoutInstance) => string;
}) {
  if (![options.workspaceHash, options.baseCandidateHash, options.publicOracleHash].every((v) => HASH.test(v)) ||
      !GIT_OBJECT_ID.test(options.implementationSha) || !GIT_OBJECT_ID.test(options.implementationTreeSha) ||
      !options.implementationFiles.length || options.implementationFiles.some((row) => !row.path || !HASH.test(row.sha256))) throw new Error('REPAIR_LIFECYCLE_BINDING_INVALID');
  const now = options.now ?? (() => new Date().toISOString());
  const run: Record<string, unknown> = {state: 'REPAIR_CONTEXT_READY', lifecycleEvents: [], workspaceHash: options.workspaceHash,
    baseCandidateHash: options.baseCandidateHash, publicOracleHash: options.publicOracleHash, implementationSha: options.implementationSha,
    implementationTreeSha: options.implementationTreeSha, implementationFiles: structuredClone(options.implementationFiles),
    backend: options.backend, modelRequestCount: 0};
  let frozenRoot: string | undefined;
  let frozenHash: string | undefined;
  let holdout: HoldoutInstance | undefined;
  let holdoutObjectId: string | undefined;
  const invalidate = (reason: string): never => { run.state = 'INVALID'; run.invalidReason = reason; throw new Error(reason); };
  const recordEvent = (event: string, at = now()) => {
    if (!Number.isFinite(Date.parse(at))) invalidate('LIFECYCLE_EVENT_TIMESTAMP_INVALID');
    const lifecycleEvents = run.lifecycleEvents as {sequence: number; event: string; at: string}[];
    lifecycleEvents.push({sequence: lifecycleEvents.length, event, at});
  };
  const requireState = (state: string) => { if (run.state !== state) throw new Error(`REPAIR_LIFECYCLE_INVALID_TRANSITION:${String(run.state)}:${state}`); };
  const assertFrozen = () => {
    if (!frozenRoot || !frozenHash) invalidate('FROZEN_CANDIDATE_MISSING');
    let actual: string;
    try { actual = hashRepairTree(frozenRoot); } catch { invalidate('FROZEN_CANDIDATE_MUTATED'); }
    if (actual! !== frozenHash) invalidate('FROZEN_CANDIDATE_MUTATED');
  };
  return {
    snapshot: () => structuredClone(run),
    recordModelResult(input: {requestSha256: string; responseSha256: string; validatedResponseSha256: string; patchSha256: string}) {
      requireState('REPAIR_CONTEXT_READY');
      if (run.modelRequestCount !== 0 || ![input.requestSha256, input.responseSha256, input.validatedResponseSha256, input.patchSha256].every((v) => HASH.test(v))) throw new Error('MODEL_RESULT_BINDING_INVALID');
      Object.assign(run, {modelRequestSha256: input.requestSha256, modelResponseSha256: input.responseSha256,
        validatedResponseSha256: input.validatedResponseSha256, patchSha256: input.patchSha256, modelRequestCount: 1, state: 'MODEL_RESULT_RECEIVED'});
      recordEvent('MODEL_RESULT_RECEIVED');
    },
    applyCandidate(candidateHash: string) {
      requireState('MODEL_RESULT_RECEIVED');
      if (!HASH.test(candidateHash) || hashRepairTree(options.candidateRoot) !== candidateHash || candidateHash === options.baseCandidateHash) throw new Error('REPAIR_CANDIDATE_HASH_INVALID');
      run.candidateHash = candidateHash; run.state = 'CANDIDATE_APPLIED';
    },
    recordBuildCandidate(candidateHash: string) {
      requireState('CANDIDATE_APPLIED');
      if (!HASH.test(candidateHash) || hashRepairTree(options.candidateRoot) !== candidateHash) return invalidate('BUILT_CANDIDATE_HASH_INVALID');
      run.preBuildCandidateHash = run.candidateHash;
      run.candidateHash = candidateHash;
    },
    evaluatePublic(evidence: GateEvidence[]) {
      requireState('CANDIDATE_APPLIED');
      const candidateHash = String(run.candidateHash);
      if (!Array.isArray(evidence) || evidence.length !== GATES.length || new Set(evidence.map((e) => e.gate)).size !== GATES.length ||
          !evidence.every((e) => validEvidence(e) && e.candidateHash === candidateHash && e.backend === options.backend) || hashRepairTree(options.candidateRoot) !== candidateHash) {
        return invalidate('PUBLIC_EVIDENCE_INVALID');
      }
      const runtimeHashes = new Set(evidence.map((e) => e.runtimeSha256));
      const operational = evidence.some((e) => e.semantic === 'ERROR' || (e.semantic !== 'FAIL' && e.semantic !== 'NOT_RUN' && e.exitCode !== 0)) || runtimeHashes.size !== 1;
      const semanticFail = evidence.some((e) => e.semantic === 'FAIL');
      const semanticPass = evidence.every((e) => e.semantic === 'PASS');
      run.publicEvidence = structuredClone(evidence);
      run.publicOutcome = operational ? 'INCONCLUSIVE' : semanticPass ? 'PASS' : 'FAIL';
      recordEvent('PUBLIC_EVALUATION_COMPLETED');
      if (semanticFail || operational || !semanticPass) {
        run.decision = decideFinal({operationalError: operational, publicPass: semanticPass, holdoutStatus: 'UNAVAILABLE'});
        run.reasonCodes = [operational ? 'PUBLIC_OPERATIONAL_FAILURE' : 'PUBLIC_SEMANTIC_FAILURE'];
        run.state = 'COMPLETED';
        return {outcome: run.publicOutcome, decision: run.decision};
      }
      run.publicRuntimeSha256 = [...runtimeHashes][0];
      run.state = 'PUBLIC_EVALUATED';
      return {outcome: 'PASS', decision: null};
    },
    freezeCandidate() {
      requireState('PUBLIC_EVALUATED');
      if (holdout || hashRepairTree(options.candidateRoot) !== run.candidateHash) return invalidate('CANDIDATE_CHANGED_BEFORE_FREEZE');
      const privateRoot = mkdtempSync(path.join(os.tmpdir(), 'cat-p05s-frozen-'));
      frozenRoot = path.join(privateRoot, 'candidate');
      copyTree(options.candidateRoot, frozenRoot);
      frozenHash = hashRepairTree(frozenRoot);
      if (frozenHash !== run.candidateHash) return invalidate('CANDIDATE_CHANGED_DURING_FREEZE');
      chmodSync(frozenRoot, 0o500);
      const frozenAt = now();
      if (!Number.isFinite(Date.parse(frozenAt))) return invalidate('FREEZE_TIMESTAMP_INVALID');
      const freezeRecord = {baseCandidateHash: options.baseCandidateHash, workspaceHash: options.workspaceHash,
        modelRequestSha256: run.modelRequestSha256, modelResponseSha256: run.modelResponseSha256,
        validatedResponseSha256: run.validatedResponseSha256, patchSha256: run.patchSha256,
        candidateHash: frozenHash, publicOracleHash: options.publicOracleHash,
        publicGateHashes: (run.publicEvidence as GateEvidence[]).map((e) => e.outputSha256),
        implementationSha: options.implementationSha, implementationTreeSha: options.implementationTreeSha,
        implementationFiles: options.implementationFiles, executionBackend: options.backend, candidateFrozenAt: frozenAt};
      const objectId = options.persistFrozen(frozenRoot, freezeRecord);
      if (!objectId) return invalidate('FROZEN_CANDIDATE_NOT_DURABLE');
      Object.assign(run, {frozenCandidateHash: frozenHash, frozenObjectId: objectId, candidateFrozenAt: frozenAt, state: 'CANDIDATE_FROZEN'});
      recordEvent('CANDIDATE_FROZEN', frozenAt);
      return {candidateHash: frozenHash, frozenObjectId: objectId, candidateFrozenAt: frozenAt, root: frozenRoot};
    },
    createAndSealHoldout() {
      requireState('CANDIDATE_FROZEN');
      assertFrozen();
      const created = options.createHoldout();
      if (!Buffer.isBuffer(created.bytes) || sha256(created.bytes) !== created.seal || !Number.isSafeInteger(created.challengeCount) || created.challengeCount < 1 || !created.generatorVersion) return invalidate('HOLDOUT_INSTANCE_INVALID');
      if (Date.parse(created.seedCreatedAt) <= Date.parse(String(run.candidateFrozenAt)) || Date.parse(created.createdAt) <= Date.parse(created.seedCreatedAt)) return invalidate('HOLDOUT_CREATED_BEFORE_FREEZE');
      const objectId = options.persistHoldout(created);
      if (!objectId) return invalidate('HOLDOUT_NOT_DURABLE');
      holdout = created; holdoutObjectId = objectId;
      Object.assign(run, {holdoutSeal: created.seal, seedCreatedAt: created.seedCreatedAt, holdoutCreatedAt: created.createdAt, holdoutChallengeCount: created.challengeCount,
        holdoutGeneratorVersion: created.generatorVersion, holdoutObjectId, state: 'HOLDOUT_SEALED'});
      recordEvent('HOLDOUT_CREATED', created.seedCreatedAt);
      recordEvent('HOLDOUT_SEALED', created.createdAt);
      return {seal: created.seal, seedCreatedAt: created.seedCreatedAt, createdAt: created.createdAt, challengeCount: created.challengeCount, objectId};
    },
    verifyBlind(evaluate: (input: {frozenCandidateRoot: string; holdout: HoldoutInstance}) => GateEvidence) {
      requireState('HOLDOUT_SEALED');
      assertFrozen();
      if (!holdout || sha256(holdout.bytes) !== run.holdoutSeal || !holdoutObjectId) return invalidate('HOLDOUT_SEAL_INVALID');
      let evidence: GateEvidence;
      recordEvent('BLIND_EXECUTION_STARTED');
      try { evidence = evaluate({frozenCandidateRoot: frozenRoot!, holdout}); }
      catch {
        recordEvent('BLIND_EXECUTION_COMPLETED');
        run.decision = 'INCONCLUSIVE'; run.reasonCodes = ['BLIND_EXECUTION_OPERATIONAL_FAILURE'];
        run.operationalFailure = true; run.state = 'COMPLETED';
        return {decision: 'INCONCLUSIVE' as const, evidence: null};
      }
      recordEvent('BLIND_EXECUTION_COMPLETED');
      assertFrozen();
      if (evidence.gate !== 'sealed-holdout' || !HASH.test(evidence.candidateHash) || !HASH.test(evidence.outputSha256) || !HASH.test(evidence.runtimeSha256) ||
          evidence.command.length === 0 || !evidence.command.every((v) => typeof v === 'string') || !Number.isSafeInteger(evidence.exitCode) ||
          !['PASS', 'FAIL', 'ERROR'].includes(evidence.semantic) || evidence.backend !== options.backend || evidence.candidateHash !== frozenHash) return invalidate('BLIND_EVIDENCE_INVALID');
      const operational = evidence.semantic === 'ERROR' || (evidence.exitCode !== 0 && evidence.semantic !== 'FAIL') || evidence.runtimeSha256 !== run.publicRuntimeSha256;
      const holdoutPass = !operational && evidence.semantic === 'PASS';
      run.blindEvidence = structuredClone(evidence);
      run.decision = decideFinal({operationalError: operational, publicPass: true, holdoutStatus: operational ? 'UNAVAILABLE' : 'EXECUTED', holdoutPass});
      run.reasonCodes = [operational ? 'BLIND_OPERATIONAL_FAILURE' : holdoutPass ? 'ALL_GATES_PASS' : 'SEALED_SEMANTIC_FAILURE'];
      run.state = 'COMPLETED';
      return {decision: run.decision, evidence: structuredClone(evidence)};
    },
    recordOperationalFailure(phase: string, code: string) {
      if (run.state === 'COMPLETED' || run.state === 'INVALID' || !/^[a-z][a-z0-9-]{0,63}$/.test(phase) || !/^[A-Z0-9_]{1,80}$/.test(code)) throw new Error('OPERATIONAL_FAILURE_RECORD_INVALID');
      run.operationalFailure = {phase, code};
      run.decision = 'INCONCLUSIVE'; run.reasonCodes = ['OPERATIONAL_FAILURE']; run.state = 'COMPLETED';
    },
    dispose() { if (frozenRoot) rmSync(path.dirname(frozenRoot), {recursive: true, force: true}); },
  };
}
