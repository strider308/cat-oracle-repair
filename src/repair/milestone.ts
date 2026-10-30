const HASH = /^[a-f0-9]{64}$/;

export type RepairBackend = 'NEBIUS_SANDBOX' | 'NEBIUS_OTHER_VERIFIED_EXECUTION' | 'LOCAL_DOCKER_FALLBACK';
export type RepairDecision = 'ACCEPTED' | 'REJECTED' | 'HUMAN_REQUIRED' | null;
export type RepairJobStatus = 'RUNNING' | 'COMPLETED' | 'INCONCLUSIVE' | 'CANCELLED';
export type ExperimentIntegrity = 'PASS' | 'INCOMPLETE' | 'INVALID';
export type P05Milestone = 'CAT_P05S_PASS' | 'CAT_P05S_SPONSOR_PASS_SANDBOX_BLOCKED' | 'CAT_P05S_BLOCKED';
export type BlindOutcome = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'NOT_RUN';
export type PublicGateOutcome = {gate: string; result: string; exitCode: number; failureKind: 'NONE' | 'SEMANTIC' | 'OPERATIONAL' | 'SKIPPED'; reasonCode: string | null};

export type P05EvidenceFacts = {
  publicOutcomes: PublicGateOutcome[];
  blindOutcome: BlindOutcome;
  candidateHash: string;
  freezeValid: boolean;
  holdoutValid: boolean;
  lifecycleValid: boolean;
  modelEvidenceValid: boolean;
  backend: RepairBackend | null;
  executionEvidenceValid: boolean;
  sandboxBlockerValid: boolean;
  receiptDurable: boolean;
};

export function deriveBlindSemanticResult(challenge: {value: string; updatedTtlSeconds: number}, observation: {
  ttlReturned?: unknown; found?: unknown; value?: unknown; expiresAt?: unknown;
}, startedAt: number, endedAt: number): 'SEMANTIC_PASS' | 'SEMANTIC_FAIL' {
  const ttl = observation.expiresAt;
  return observation.ttlReturned === true && observation.found === true && observation.value === challenge.value &&
    Number.isFinite(ttl) && Number(ttl) > startedAt - 2000 &&
    Number(ttl) <= endedAt + challenge.updatedTtlSeconds * 1000 + 2000 ? 'SEMANTIC_PASS' : 'SEMANTIC_FAIL';
}

const GATES = ['build', 'existing-suite', 'public-contract', 'public-oracle-v2'];
const validBackend = (value: unknown): value is RepairBackend =>
  value === 'NEBIUS_SANDBOX' || value === 'NEBIUS_OTHER_VERIFIED_EXECUTION' || value === 'LOCAL_DOCKER_FALLBACK';

export function deriveP05Outcome(input: P05EvidenceFacts) {
  if (!Array.isArray(input.publicOutcomes) || input.publicOutcomes.length !== GATES.length ||
      new Set(input.publicOutcomes.map((gate) => gate.gate)).size !== GATES.length ||
      GATES.some((name) => !input.publicOutcomes.some((gate) => gate.gate === name)) || !HASH.test(input.candidateHash)) {
    throw new Error('RECEIPT_PUBLIC_EVIDENCE_INVALID');
  }
  const gates = GATES.map((name) => input.publicOutcomes.find((item) => item.gate === name)!);
  const publicOperational = gates.some((gate) => gate.failureKind === 'OPERATIONAL');
  const publicSemantic = gates.some((gate) => gate.failureKind === 'SEMANTIC');
  const gateCodes = gates.filter((gate) => gate.failureKind === (publicOperational ? 'OPERATIONAL' : 'SEMANTIC'))
    .map((gate) => gate.reasonCode!);
  const publicPass = gates.every((gate) => gate.failureKind === 'NONE' && gate.result === 'PASS' && gate.exitCode === 0);
  if (publicOperational) return outcome('INCONCLUSIVE', null, gateCodes, input, 'INCOMPLETE', 'CAT_P05S_BLOCKED');
  if (publicSemantic) return outcome('COMPLETED', 'REJECTED', gateCodes, input, 'INCOMPLETE', 'CAT_P05S_BLOCKED');
  if (!publicPass) throw new Error('RECEIPT_PUBLIC_OUTCOME_CONTRADICTORY');
  if (!input.modelEvidenceValid || !input.lifecycleValid || !input.executionEvidenceValid || !validBackend(input.backend)) {
    return outcome('INCONCLUSIVE', null, ['EXECUTION_EVIDENCE_INCOMPLETE'], input, 'INCOMPLETE', 'CAT_P05S_BLOCKED');
  }
  if (input.blindOutcome === 'NOT_RUN' || input.blindOutcome === 'INCONCLUSIVE') {
    return outcome('INCONCLUSIVE', null, ['BLIND_EXECUTION_OPERATIONAL_FAILURE'], input, 'INCOMPLETE', 'CAT_P05S_BLOCKED');
  }
  if (!input.freezeValid || !input.holdoutValid || !input.receiptDurable) {
    return outcome('INCONCLUSIVE', null, ['EXPERIMENT_EVIDENCE_INCOMPLETE'], input, 'INCOMPLETE', 'CAT_P05S_BLOCKED');
  }
  if (input.blindOutcome !== 'PASS' && input.blindOutcome !== 'FAIL') throw new Error('RECEIPT_BLIND_OUTCOME_INVALID');
  const decision: RepairDecision = input.blindOutcome === 'PASS' ? 'ACCEPTED' : 'REJECTED';
  const reasonCodes = [input.blindOutcome === 'PASS' ? 'ALL_GATES_PASS' : 'SEALED_SEMANTIC_FAILURE'];
  let milestone: P05Milestone = 'CAT_P05S_BLOCKED';
  if (input.backend === 'NEBIUS_SANDBOX' || input.backend === 'NEBIUS_OTHER_VERIFIED_EXECUTION') milestone = 'CAT_P05S_PASS';
  else if (input.backend === 'LOCAL_DOCKER_FALLBACK' && input.sandboxBlockerValid) milestone = 'CAT_P05S_SPONSOR_PASS_SANDBOX_BLOCKED';
  return outcome('COMPLETED', decision, reasonCodes, input, 'PASS', milestone);
}

function outcome(jobStatus: RepairJobStatus, decision: RepairDecision, reasonCodes: string[], input: P05EvidenceFacts,
  experimentIntegrity: ExperimentIntegrity, milestone: P05Milestone) {
  return {blindOutcome: input.blindOutcome, executionBackend: input.backend,
    candidateResult: {jobStatus, decision, reasonCodes}, experimentIntegrity, milestone,
    candidateAccepted: decision === 'ACCEPTED'};
}
