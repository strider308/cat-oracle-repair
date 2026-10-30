import {assertResultShape, type CandidateResult} from '../core/result.ts';

export function parseTargetObservation(text: string): {ttlReturned: boolean; found: boolean; value: string | null} {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join('|') !== 'found|ttlReturned|value') throw new Error('TARGET_PROTOCOL_INVALID');
  const observation = value as Record<string, unknown>;
  if (typeof observation.ttlReturned !== 'boolean' || typeof observation.found !== 'boolean' ||
      !(typeof observation.value === 'string' || observation.value === null)) throw new Error('TARGET_PROTOCOL_INVALID');
  return observation as {ttlReturned: boolean; found: boolean; value: string | null};
}

export function inconclusiveResult(candidateSha: string, contractHash: string, evidenceManifestHash: string, reasonCode = 'TARGET_EXECUTION_INCONCLUSIVE'): CandidateResult {
  const result: CandidateResult = {
    candidateSha, contractHash, jobStatus: 'INCONCLUSIVE', decision: null, reasonCodes: [reasonCode],
    requiredGateIds: ['existing-suite', 'contract-witness'], gates: {'existing-suite': 'PASS', 'contract-witness': 'ERROR'}, evidenceManifestHash,
  };
  assertResultShape(result);
  return result;
}

export async function runHero(): Promise<Record<string, unknown>> {
  const {runP03Hero} = await import('./p03-runner.ts');
  return runP03Hero();
}