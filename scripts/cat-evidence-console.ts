import {createEvidenceConsoleServer, validateEvidenceConsoleAssets} from '../src/evidence/evidence-console-server.ts';
import {DEFAULT_PUBLIC_CASE_ID, loadPublicDecisionCase, publicCaseDefinition} from '../src/evidence/public-decision-cases.ts';

function parseArguments(args: string[]): {check: boolean; port: number; caseId: string} {
  let check = false;
  let port = 4173;
  let caseId = DEFAULT_PUBLIC_CASE_ID;
  let sawCase = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--check' && !check) {
      check = true;
    } else if (arg === '--port' && index + 1 < args.length) {
      const value = args[++index];
      if (!/^\d+$/.test(value)) throw new Error('Port must be an integer from 0 to 65535.');
      port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
    } else if (arg === '--case' && !sawCase && index + 1 < args.length && args[index + 1] !== '') {
      caseId = args[++index];
      sawCase = true;
    } else {
      throw new Error('Usage: cat-evidence-console.ts [--check] [--port <0-65535>] [--case <public-case-id>]');
    }
  }
  if (check && args.includes('--port')) throw new Error('--check does not start a server and cannot be combined with --port.');
  publicCaseDefinition(caseId);
  return {check, port, caseId};
}

try {
  const {check, port, caseId} = parseArguments(process.argv.slice(2));
  if (check) {
    const sourceStatus = validateEvidenceConsoleAssets();
    loadPublicDecisionCase(caseId);
    process.stdout.write(`CAT_EVIDENCE_CONSOLE_P04_SOURCE=${sourceStatus}\n`);
    process.stdout.write('CAT_EVIDENCE_CONSOLE_CHECK=PASS\n');
  } else {
    const selected = loadPublicDecisionCase(caseId).normalized;
    const server = createEvidenceConsoleServer(caseId);
    server.once('error', (error) => {
      process.stderr.write('CAT_EVIDENCE_CONSOLE=ERROR ' + (error instanceof Error ? error.message : String(error)) + '\n');
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Console server did not bind a TCP port.');
      const base = 'http://127.0.0.1:' + address.port;
      process.stdout.write([
        'CAT_EVIDENCE_CONSOLE=READY',
        'CAT_EVIDENCE_CONSOLE_URL=' + base,
        'CAT_EVIDENCE_CASE=' + selected.id,
        'CAT_EVIDENCE_DECISION=' + selected.decision,
        'CAT_EVIDENCE_CASE_URL=' + (caseId === DEFAULT_PUBLIC_CASE_ID ? base + '/' : base + '/?case=' + caseId),
      ].join('\n') + '\n');
    });
  }
} catch (error) {
  const message = error instanceof Error && error.message === 'PUBLIC_CASE_UNKNOWN' ? 'Unknown public case.' : 'Invalid evidence console arguments.';
  process.stderr.write('CAT_EVIDENCE_CONSOLE=ERROR ' + message + '\n');
  process.exitCode = 2;
}
