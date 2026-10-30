import {canonical, project} from './canonical.ts';

export type OracleDefinition = {id: string; version: number; visibility: 'PUBLIC' | 'SEALED'; observes: string[]; expected: Record<string, unknown>};
export type EvaluationOutcome = 'PASS' | 'FAIL' | 'ERROR';

export function evaluateObservation(observation: Record<string, unknown>, oracle: OracleDefinition): EvaluationOutcome {
  try { return canonical(project(observation, oracle.observes)) === canonical(oracle.expected) ? 'PASS' : 'FAIL'; }
  catch { return 'ERROR'; }
}
