import {createHash} from 'node:crypto';

export type HoldoutStatus = 'SEALED' | 'EXECUTED' | 'UNAVAILABLE' | 'INVALID';
export type FinalDecision = 'ACCEPTED' | 'REJECTED' | 'INCONCLUSIVE';
export function sha256(bytes: string | Buffer) { return createHash('sha256').update(bytes).digest('hex'); }
export function decideFinal(input: {operationalError?: boolean; publicPass: boolean; holdoutStatus: HoldoutStatus; holdoutPass?: boolean}): FinalDecision {
  if (input.operationalError) return 'INCONCLUSIVE';
  if (!input.publicPass) return 'REJECTED';
  if (input.holdoutStatus !== 'EXECUTED' || input.holdoutPass === undefined) return 'INCONCLUSIVE';
  if (!input.holdoutPass) return 'REJECTED';
  return 'ACCEPTED';
}
export function verifyHoldout(bytes: Buffer, expectedSeal: string) { return sha256(bytes) === expectedSeal; }
