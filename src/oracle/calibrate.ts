export type OracleStatus = 'UNCALIBRATED' | 'WEAK' | 'CALIBRATED';

export function calibrateOracle(knownWrongRejected: boolean, knownGoodAccepted: boolean, equivalentAccepted: boolean, attacksRejected: boolean): OracleStatus {
  if (!knownWrongRejected || !knownGoodAccepted || !equivalentAccepted) return 'UNCALIBRATED';
  return attacksRejected ? 'CALIBRATED' : 'WEAK';
}
