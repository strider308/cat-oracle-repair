import {runP03Hero} from '../src/evaluation/p03-runner.ts';

const jsonMode = process.argv.slice(2).includes('--json');
try {
  const result = await runP03Hero();
  if (jsonMode) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else process.stdout.write([
    'CAT_HERO_CASE=' + result.caseId,
    'CAT_EXISTING_SUITE=PASS (' + result.suite.testsPassed + ' passed, ' + result.suite.testsFailed + ' failed)',
    'CAT_V1=' + result.v1Hash,
    'CAT_V1_STATUS=' + result.postAttackStatus,
    'CAT_CANDIDATE=' + result.result.candidateSha,
    'CAT_JOB_STATUS=' + result.result.jobStatus,
    'CAT_DECISION=' + result.result.decision,
    'CAT_WRONG_OBSERVATION=' + JSON.stringify(result.candidates.wrong.v2),
    'CAT_RECEIPT=' + result.receiptPath,
    'CAT_RECEIPT_HASH=' + result.receiptHash,
    result.result.decision === 'REJECTED' ? 'CAT_HERO_PASS' : 'CAT_HERO_FAIL',
  ].join('\n') + '\n');
  if (result.result.decision !== 'REJECTED') process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const details = error && typeof error === 'object' ? error : {};
  process.stderr.write(jsonMode
    ? JSON.stringify({jobStatus: 'INCONCLUSIVE', decision: null, error: message, diagnostics: details.diagnostics || null,
      precedingDiagnostics: details.precedingDiagnostics || []}) + '\n'
    : 'CAT_HERO_INCONCLUSIVE=' + message + '\n');
  process.exitCode = 1;
}
