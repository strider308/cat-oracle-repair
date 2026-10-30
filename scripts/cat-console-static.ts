import {createHash, randomUUID} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PUBLIC_CASE_REGISTRY, loadPublicFixtureCase} from '../src/evidence/public-decision-cases.ts';
import {validateEvidenceConsoleAssets} from '../src/evidence/evidence-console-server.ts';
import {loadTestDiscriminationSummary} from '../src/evidence/test-discrimination-summary.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = ['console/index.html', 'console/styles.css', 'console/app.js'] as const;
const PUBLIC_HEADERS = 'deployment/_headers';
const PRIVATE_DATA = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /[A-Za-z]:\\(?:Users|home)\\/i,
  /\/home\/[^/\s]+/i,
  /\.agent-runs[\\/]+(?:p05-s[\\/]+)?[^/\s]+private/i,
  /reasoning_content\s*:/i,
  /authorization\s*:\s*bearer\b/i,
];

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertPublicText(bytes: Buffer, label: string): void {
  const text = bytes.toString('utf8');
  if (PRIVATE_DATA.some((pattern) => pattern.test(text))) throw new Error(`STATIC_CONSOLE_PRIVATE_DATA:${label}`);
}

export function buildStaticConsole(outputDir: string, root = ROOT): {outputDir: string; sourceCommit: string; p04SourceVerification: string; files: {path: string; bytes: number; sha256: string}[]} {
  const repo = path.resolve(root);
  const output = path.resolve(outputDir);
  const validationDirectory = path.join(repo, '.verification-runs');
  if (!output.startsWith(validationDirectory + path.sep)) throw new Error('STATIC_CONSOLE_OUTPUT_OUTSIDE_VALIDATION_DIR');
  if (existsSync(output)) throw new Error('STATIC_CONSOLE_OUTPUT_EXISTS');

  const sourceChanges = execFileSync('git', ['-C', repo, 'status', '--porcelain=v1', '--untracked-files=no'], {encoding: 'utf8'}).trim();
  if (sourceChanges) throw new Error('STATIC_CONSOLE_REQUIRES_COMMITTED_SOURCE');
  const sourceCommit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('STATIC_CONSOLE_SOURCE_COMMIT_INVALID');

  const p04SourceVerification = 'CASE_OMITTED_STRICT_VERIFICATION_UNAVAILABLE';

  validateEvidenceConsoleAssets();
  mkdirSync(path.join(output, 'cases'), {recursive: true});
  mkdirSync(path.join(output, 'sources'), {recursive: true});
  mkdirSync(path.join(output, 'executions'), {recursive: true});
  for (const relative of ASSETS) {
    const bytes = readFileSync(path.join(repo, relative));
    assertPublicText(bytes, relative);
    const destination = path.basename(relative);
    writeFileSync(path.join(output, destination), bytes, {flag: 'wx'});
  }
  const headerBytes = readFileSync(path.join(repo, PUBLIC_HEADERS));
  assertPublicText(headerBytes, PUBLIC_HEADERS);
  writeFileSync(path.join(output, '_headers'), headerBytes, {flag: 'wx'});
  for (const {id} of PUBLIC_CASE_REGISTRY.filter(({id}) => id !== 'p04-good-control-001')) {
    const bytes = Buffer.from(loadPublicFixtureCase(id, repo).publicJson, 'utf8');
    assertPublicText(bytes, id);
    writeFileSync(path.join(output, 'cases', `${id}.json`), bytes, {flag: 'wx'});
  }
  const {summary, sourceFiles} = loadTestDiscriminationSummary(repo);
  const executionFiles = summary.executableOracleRepairs.map((receipt: Record<string, any>) => {
    if (receipt.verificationStatus !== 'EXECUTED_VERIFIED_CASE_SCOPE' || !/^executions\/[a-z0-9-]+\.json$/.test(receipt.receiptFile)) throw new Error('STATIC_CONSOLE_EXECUTION_RECEIPT_INVALID');
    const {receiptFile, ...receiptBody} = receipt;
    const bytes = Buffer.from(`${JSON.stringify(receiptBody, null, 2)}\n`, 'utf8');
    assertPublicText(bytes, receipt.receiptFile);
    writeFileSync(path.join(output, ...receipt.receiptFile.split('/')), bytes, {flag: 'wx'});
    return {path: receipt.receiptFile, bytes: bytes.byteLength, sha256: sha256(bytes)};
  });
  const summaryBytes = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  assertPublicText(summaryBytes, 'test-discrimination-summary.json');
  writeFileSync(path.join(output, 'test-discrimination-summary.json'), summaryBytes, {flag: 'wx'});
  for (const source of sourceFiles) {
    assertPublicText(source.bytes, source.path);
    writeFileSync(path.join(output, ...source.path.split('/')), source.bytes, {flag: 'wx'});
  }

  const expected = ['_headers', 'app.js', 'index.html', 'styles.css', 'test-discrimination-summary.json',
    ...sourceFiles.map(({path: relativePath}) => relativePath),
    ...executionFiles.map(({path: relativePath}) => relativePath),
    ...PUBLIC_CASE_REGISTRY.filter(({id}) => id !== 'p04-good-control-001').map(({id}) => `cases/${id}.json`)];
  const actual = [
    ...readdirSync(output).filter((name) => !['cases', 'sources', 'executions'].includes(name)),
    ...readdirSync(path.join(output, 'cases')).map((name) => `cases/${name}`),
    ...readdirSync(path.join(output, 'sources')).map((name) => `sources/${name}`),
    ...readdirSync(path.join(output, 'executions')).map((name) => `executions/${name}`),
  ].sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new Error('STATIC_CONSOLE_FILE_ALLOWLIST_MISMATCH');
  const files = expected.map((relative) => {
    const bytes = readFileSync(path.join(output, ...relative.split('/')));
    return {path: relative, bytes: bytes.byteLength, sha256: sha256(bytes)};
  });
  writeFileSync(path.join(output, 'site-manifest.json'), `${JSON.stringify({
    schema: 'CatStaticConsoleManifestV1',
    sourceCommit,
    p04SourceVerification,
    files,
  }, null, 2)}\n`, {flag: 'wx'});
  return {outputDir: output, sourceCommit, p04SourceVerification, files};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const outputDir = path.join(ROOT, '.verification-runs', `cat-console-static-${randomUUID()}`);
    const result = buildStaticConsole(outputDir, ROOT);
    process.stdout.write(`CAT_STATIC_CONSOLE=PASS\nCAT_STATIC_CONSOLE_SOURCE=${result.sourceCommit}\nCAT_STATIC_CONSOLE_P04_SOURCE=${result.p04SourceVerification}\nCAT_STATIC_CONSOLE_FILES=${result.files.length}\nCAT_STATIC_CONSOLE_DIR=${result.outputDir}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/[^A-Z0-9_:-]/gi, '_') : 'UNKNOWN';
    process.stderr.write(`CAT_STATIC_CONSOLE=FAIL\nCAT_STATIC_CONSOLE_ERROR=${message}\n`);
    process.exitCode = 1;
  }
}
