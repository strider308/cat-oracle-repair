import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_PUBLIC_CASE_ID, PUBLIC_CASE_REGISTRY, loadPublicFixtureCase, publicCaseDefinition} from './public-decision-cases.ts';
import {loadTestDiscriminationSummary} from './test-discrimination-summary.ts';

type ConsoleAsset = {body: Buffer; contentType: string};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

const protectedPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /[A-Za-z]:\\(?:Users|home)\\/i,
  /\/home\/[^/\s]+/i,
  /\.agent-runs[\\/]+(?:p05-s[\\/]+)?[^/\s]+private/i,
  /reasoning_content\s*:/i,
  /authorization\s*:\s*bearer\b/i,
];

function assertNoProtectedData(text: string, source: string): void {
  if (protectedPatterns.some((pattern) => pattern.test(text))) throw new Error('CONSOLE_PROTECTED_DATA:' + source);
}

function loadResources(defaultCaseId: string): {assets: Map<string, ConsoleAsset>; cases: Map<string, ReturnType<typeof loadPublicFixtureCase>>} {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const read = (relativePath: string) => readFileSync(path.join(root, relativePath));
  const html = read('console/index.html');
  const css = read('console/styles.css');
  const client = read('console/app.js');
  publicCaseDefinition(defaultCaseId);
  if (!PUBLIC_CASE_REGISTRY.some(({id}) => id === defaultCaseId && id !== 'p04-good-control-001')) throw new Error('CONSOLE_CASE_UNAVAILABLE');
  const servedCases = PUBLIC_CASE_REGISTRY.filter(({id}) => id !== 'p04-good-control-001');
  const cases = new Map(servedCases.map(({id}) => [id, loadPublicFixtureCase(id, root)]));
  const {summary, sourceFiles} = loadTestDiscriminationSummary(root);
  const sourceCommit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  const reportBytes = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const sourceAssets = sourceFiles.map(({path: relativePath, bytes}) => [
    '/' + relativePath,
    {body: bytes, contentType: 'application/json; charset=utf-8'},
  ] as const);
  const executionAssets = summary.executableOracleRepairs.map((receipt: Record<string, any>) => {
    const {receiptFile, ...receiptBody} = receipt;
    const body = Buffer.from(`${JSON.stringify(receiptBody, null, 2)}\n`, 'utf8');
    assertNoProtectedData(body.toString('utf8'), receipt.receiptFile);
    return [`/${receipt.receiptFile}`, {body, contentType: 'application/json; charset=utf-8'}] as const;
  });

  const htmlText = html.toString('utf8');
  const cssText = css.toString('utf8');
  const clientText = client.toString('utf8');
  for (const [source, text] of [['html', htmlText], ['css', cssText], ['client', clientText], ['test-discrimination-summary', reportBytes.toString('utf8')], ...sourceFiles.map(({path: relativePath, bytes}) => [relativePath, bytes.toString('utf8')] as const), ...executionAssets.map(([route, asset]) => [route, asset.body.toString('utf8')] as const), ...[...cases].map(([id, value]) => [id, value.publicJson] as const)] as const) {
    assertNoProtectedData(text, source);
    if (/https?:\/\//i.test(text)) throw new Error('CONSOLE_EXTERNAL_URL:' + source);
  }
  if (/linear-gradient|radial-gradient|conic-gradient|@import|text-shadow/i.test(cssText)) throw new Error('CONSOLE_DESIGN_CONTRACT');
  if (/\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new\s+Function)\b/.test(clientText)) throw new Error('CONSOLE_UNSAFE_RENDERING');
  if (/fetch\s*\(\s*[^"'`]/.test(clientText.replace(/fetch\s*\(\s*"\.\/site-manifest\.json"/g, ''))) throw new Error('CONSOLE_FETCH_ALLOWLIST');
  if (/<style\b|style\s*=/i.test(htmlText)) throw new Error('CONSOLE_INLINE_ASSET');

  const assets = new Map<string, ConsoleAsset>([
    ['/', {body: html, contentType: 'text/html; charset=utf-8'}],
    ['/index.html', {body: html, contentType: 'text/html; charset=utf-8'}],
    ['/styles.css', {body: css, contentType: 'text/css; charset=utf-8'}],
    ['/app.js', {body: client, contentType: 'text/javascript; charset=utf-8'}],
    ['/test-discrimination-summary.json', {body: reportBytes, contentType: 'application/json; charset=utf-8'}],
    ...sourceAssets,
    ...executionAssets,
    ['/healthz', {body: Buffer.from('{"status":"ok"}', 'utf8'), contentType: 'application/json; charset=utf-8'}],
  ]);
  const manifestFiles = [
    {path: 'index.html', body: html}, {path: 'styles.css', body: css}, {path: 'app.js', body: client},
    {path: 'test-discrimination-summary.json', body: reportBytes},
    ...sourceFiles.map(({path: relativePath, bytes}) => ({path: relativePath, body: bytes})),
    ...executionAssets.map(([route, asset]) => ({path: route.slice(1), body: asset.body})),
    ...[...cases].map(([id, value]) => ({path: `cases/${id}.json`, body: Buffer.from(value.publicJson, 'utf8')})),
  ].map(({path: relativePath, body}) => ({path: relativePath, bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex')}));
  assets.set('/site-manifest.json', {body: Buffer.from(`${JSON.stringify({schema: 'CatStaticConsoleManifestV1', sourceCommit, p04SourceVerification: 'CASE_OMITTED_STRICT_VERIFICATION_UNAVAILABLE', files: manifestFiles}, null, 2)}\n`, 'utf8'), contentType: 'application/json; charset=utf-8'});
  return {assets, cases};
}

function applyHeaders(response: ServerResponse): void {
  response.setHeader('Content-Security-Policy', CSP);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Cache-Control', 'no-store');
}

function send(response: ServerResponse, status: number, body: Buffer, contentType: string, head: boolean): void {
  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', String(body.byteLength));
  if (head) response.end();
  else response.end(body);
}

function handleRequest(request: IncomingMessage, response: ServerResponse, routes: Map<string, ConsoleAsset>, cases: Map<string, ReturnType<typeof loadPublicDecisionCase>>, defaultCaseId: string): void {
  applyHeaders(response);
  let pathname: string;
  let selectedCaseId = defaultCaseId;
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    pathname = url.pathname;
    const keys = [...url.searchParams.keys()];
    const caseIds = url.searchParams.getAll('case');
    const views = url.searchParams.getAll('view');
    if (keys.some((key) => key !== 'case' && key !== 'view') || caseIds.length > 1 || views.length > 1 ||
        caseIds.length === 1 && (!caseIds[0] || views.length > 0) || views.length === 1 && views[0] !== 'discrimination') {
      send(response, 400, Buffer.from('Invalid case query'), 'text/plain; charset=utf-8', request.method === 'HEAD');
      return;
    }
    if (caseIds.length === 1) selectedCaseId = caseIds[0];
  } catch {
    send(response, 404, Buffer.from('Not found'), 'text/plain; charset=utf-8', request.method === 'HEAD');
    return;
  }
  if (!cases.has(selectedCaseId)) {
    send(response, 404, Buffer.from('Not found'), 'text/plain; charset=utf-8', request.method === 'HEAD');
    return;
  }
  const caseMatch = /^\/cases\/([a-z0-9-]+)\.json$/.exec(pathname);
  if (caseMatch && !cases.has(caseMatch[1])) {
    send(response, 404, Buffer.from('Not found'), 'text/plain; charset=utf-8', request.method === 'HEAD');
    return;
  }
  const asset = caseMatch
    ? {body: Buffer.from(cases.get(caseMatch[1])!.publicJson, 'utf8'), contentType: 'application/json; charset=utf-8'}
    : pathname === '/evidence.json'
      ? {body: Buffer.from(cases.get(selectedCaseId)!.publicJson, 'utf8'), contentType: 'application/json; charset=utf-8'}
      : routes.get(pathname);
  if (!asset) {
    send(response, 404, Buffer.from('Not found'), 'text/plain; charset=utf-8', request.method === 'HEAD');
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    send(response, 405, Buffer.from('Method not allowed'), 'text/plain; charset=utf-8', false);
    return;
  }
  send(response, 200, asset.body, asset.contentType, request.method === 'HEAD');
}

export function validateEvidenceConsoleAssets(): 'P04_CASE_OMITTED_STRICT_VERIFICATION_UNAVAILABLE' {
  loadResources(DEFAULT_PUBLIC_CASE_ID);
  return 'P04_CASE_OMITTED_STRICT_VERIFICATION_UNAVAILABLE';
}

export function createEvidenceConsoleServer(defaultCaseId = DEFAULT_PUBLIC_CASE_ID): Server {
  const {assets, cases} = loadResources(defaultCaseId);
  return createServer((request, response) => handleRequest(request, response, assets, cases, defaultCaseId));
}
