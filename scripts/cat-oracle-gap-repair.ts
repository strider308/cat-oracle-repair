import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runOracleRepairDemonstrations} from '../src/oracle/execute-fixtures.ts';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const receipt of runOracleRepairDemonstrations()) {
      process.stdout.write(`CAT_ORACLE_REPAIR=${receipt.verificationStatus} CASE=${receipt.caseId} RUN=${receipt.runId} RECEIPT_SHA256=${receipt.receiptSha256}\n`);
    }
  } catch (error) {
    process.stderr.write(`CAT_ORACLE_REPAIR=UNRESOLVED REASON=${error instanceof Error ? error.message : 'UNKNOWN'}\n`);
    process.exitCode = 1;
  }
}
