import {runP03Hero, OracleStatus} from '../src/evaluation/p03-runner.ts';

const jsonMode = process.argv.slice(2).includes('--json');
try {
  const result = await runP03Hero();
  if (jsonMode) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else process.stdout.write([
    'CAT_ORACLE_CASE=' + result.caseId,
    'CAT_ORACLE_V1=' + result.v1Hash,
    'CAT_ORACLE_V1_STATUS=' + result.postAttackStatus,
    'CAT_SURVIVOR=S1-preserve-finite-expiry',
    'CAT_SURVIVOR_V1=' + result.v1Results.survivor,
    'CAT_ORACLE_V2=' + result.v2Hash,
    'CAT_SURVIVOR_V2=' + result.v2Results.survivor,
    'CAT_KNOWN_GOOD_V2=' + result.v2Results.good,
    'CAT_EQUIVALENT_V2=' + result.v2Results.equivalent,
    'CAT_ORACLE_STATUS=' + result.oracleStatus,
    result.oracleStatus === OracleStatus.CALIBRATED ? 'CAT_P03_PASS' : 'CAT_P03_BLOCKED',
  ].join('\n') + '\n');
  if (result.oracleStatus !== OracleStatus.CALIBRATED) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const details = error && typeof error === 'object' ? error : {};
  process.stderr.write(jsonMode
    ? JSON.stringify({oracleStatus: OracleStatus.UNCALIBRATED, jobStatus: 'INCONCLUSIVE', decision: null, error: message,
      diagnostics: details.diagnostics || null, precedingDiagnostics: details.precedingDiagnostics || []}) + '\n'
    : 'CAT_P03_BLOCKED=' + message + '\n');
  process.exitCode = 1;
}
