export type JobStatus = 'RUNNING' | 'COMPLETED' | 'INCONCLUSIVE' | 'CANCELLED';
export type Decision = 'ACCEPTED' | 'REJECTED' | 'HUMAN_REQUIRED';
export type GateStatus = 'PASS' | 'FAIL' | 'ERROR' | 'NOT_RUN' | 'NOT_APPLICABLE';

export type CandidateResult = {
  candidateSha: string;
  contractHash: string;
  jobStatus: JobStatus;
  decision: Decision | null;
  reasonCodes: string[];
  requiredGateIds: string[];
  gates: Record<string, GateStatus>;
  evidenceManifestHash: string;
};

export type AcceptanceContext = {
  expectedCandidateSha: string;
  expectedContractHash: string;
};

export type AcceptanceCheck = {
  ok: boolean;
  errors: string[];
};

const SHA_256_HEX = /^[a-f0-9]{64}$/i;

export function validateAcceptance(
  result: CandidateResult,
  context: AcceptanceContext,
): AcceptanceCheck {
  const errors: string[] = [];

  if (!result.candidateSha || result.candidateSha !== context.expectedCandidateSha) {
    errors.push('STALE_OR_MISMATCHED_CANDIDATE_SHA');
  }
  if (!result.contractHash || result.contractHash !== context.expectedContractHash) {
    errors.push('STALE_OR_MISMATCHED_CONTRACT_HASH');
  }
  if (!result.evidenceManifestHash || !SHA_256_HEX.test(result.evidenceManifestHash)) {
    errors.push('INVALID_EVIDENCE_MANIFEST_HASH');
  }
  if (result.jobStatus !== 'COMPLETED') {
    errors.push('JOB_NOT_COMPLETED');
  }
  if (result.decision !== 'ACCEPTED') {
    errors.push('DECISION_NOT_ACCEPTED');
  }
  if (result.requiredGateIds.length === 0) {
    errors.push('NO_REQUIRED_GATES');
  }

  const uniqueGateIds = new Set(result.requiredGateIds);
  if (uniqueGateIds.size !== result.requiredGateIds.length) {
    errors.push('DUPLICATE_REQUIRED_GATE');
  }

  for (const gateId of uniqueGateIds) {
    if (!(gateId in result.gates)) {
      errors.push(`MISSING_REQUIRED_GATE:${gateId}`);
      continue;
    }
    if (result.gates[gateId] !== 'PASS') {
      errors.push(`REQUIRED_GATE_NOT_PASS:${gateId}:${result.gates[gateId]}`);
    }
  }

  return {ok: errors.length === 0, errors};
}

export function canAccept(
  result: CandidateResult,
  context: AcceptanceContext,
): boolean {
  return validateAcceptance(result, context).ok;
}

export function assertResultShape(result: CandidateResult): void {
  if (!result.candidateSha) throw new Error('candidateSha is required');
  if (!result.contractHash) throw new Error('contractHash is required');
  if (!Array.isArray(result.reasonCodes)) throw new Error('reasonCodes must be an array');
  if (!Array.isArray(result.requiredGateIds)) throw new Error('requiredGateIds must be an array');
  if (!result.gates || typeof result.gates !== 'object') throw new Error('gates must be an object');

  if (result.jobStatus === 'RUNNING' && result.decision !== null) {
    throw new Error('running jobs cannot have a semantic decision');
  }
  if ((result.jobStatus === 'INCONCLUSIVE' || result.jobStatus === 'CANCELLED') && result.decision !== null) {
    throw new Error('incomplete jobs cannot have a semantic decision');
  }
  if (result.jobStatus === 'COMPLETED' && result.decision === null) {
    throw new Error('completed jobs require a semantic decision');
  }
}
