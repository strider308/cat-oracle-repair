import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test, {after} from 'node:test';
import {createEvidenceConsoleServer, validateEvidenceConsoleAssets} from '../src/evidence/evidence-console-server.ts';
import {DEFAULT_PUBLIC_CASE_ID, PUBLIC_CASE_REGISTRY, loadPublicDecisionCase} from '../src/evidence/public-decision-cases.ts';
import {serializePublicEvidenceV1, validatePublicEvidenceV1} from '../src/evidence/public-evidence-v1.ts';

const html = readFileSync(new URL('../console/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../console/styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../console/app.js', import.meta.url), 'utf8');
const ids = PUBLIC_CASE_REGISTRY.map(({id}) => id).filter((id) => id !== 'p04-good-control-001');
const fixtureBytes = readFileSync(new URL('../fixtures/public-evidence/node-cache-ttl-zero-001.rejected.json', import.meta.url));
const fixture = JSON.parse(fixtureBytes.toString('utf8'));
validatePublicEvidenceV1(fixture);

const server = createEvidenceConsoleServer();
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert.ok(address && typeof address !== 'string');
const base = 'http://127.0.0.1:' + address.port;
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
const get = async (route: string, init?: RequestInit) => {
  const response = await fetch(base + route, init);
  const body = Buffer.from(await response.arrayBuffer());
  return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
};

test('C01 GET / returns HTML', async () => {
  const response = await get('/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
});

test('C02 HTML has semantic shell markers', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<main\b/);
  assert.match(html, /Checking the public evidence package/);
  assert.match(app, /element\("header"/);
  assert.match(app, /element\("main"/);
  assert.match(app, /element\("section"/);
  assert.match(app, /element\("footer"/);
});

test('C03 HTML references local CSS and JavaScript', () => {
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/app\.js"/);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test('C04 HTML has no inline script', () => {
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i);
});

test('C05 HTML has no inline style', () => {
  assert.doesNotMatch(html, /<style\b|style\s*=/i);
});

test('C06 GET /styles.css returns CSS', async () => {
  const response = await get('/styles.css');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/css/);
});

test('C07 GET /app.js returns JavaScript content type', async () => {
  const response = await get('/app.js');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/javascript/);
});

test('C08 GET /evidence.json returns JSON', async () => {
  const response = await get('/evidence.json');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
});

test('C09 evidence bytes equal canonical fixture serialization', async () => {
  const response = await get('/evidence.json');
  assert.equal(Buffer.from(await response.arrayBuffer()).toString('utf8'), serializePublicEvidenceV1(fixture));
  assert.deepEqual(Buffer.from(serializePublicEvidenceV1(fixture)), Buffer.from(fixtureBytes.toString('utf8').replace(/\r\n/g, '\n')));
});

test('C10 evidence route validates with PublicEvidenceV1', async () => {
  validatePublicEvidenceV1(await (await get('/evidence.json')).json());
});

test('C11 GET /healthz returns a safe status', async () => {
  const response = await get('/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {status: 'ok'});
});

test('C12 unknown route returns 404', async () => {
  assert.equal((await get('/unknown')).status, 404);
});

test('C13 .agent-runs path returns 404', async () => {
  assert.equal((await get('/.agent-runs/p05-s/private.json')).status, 404);
});

test('C14 .gortex path returns 404', async () => {
  assert.equal((await get('/.gortex/config')).status, 404);
});

test('C15 dot-segment traversal cannot expose package.json', async () => {
  assert.equal((await get('/../package.json')).status, 404);
});

test('C16 encoded traversal cannot expose files', async () => {
  assert.equal((await get('/%2e%2e%2fpackage.json')).status, 404);
});

test('C17 POST / returns 405', async () => {
  const response = await get('/', {method: 'POST'});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('C18 browser routes have security headers', async () => {
  const response = await get('/');
  for (const header of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'cache-control']) {
    assert.ok(response.headers.has(header), header);
  }
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('C19 CSP does not allow unsafe-inline', async () => {
  assert.doesNotMatch((await get('/')).headers.get('content-security-policy') ?? '', /unsafe-inline/i);
});

test('C20 CSP scripts are same-origin only', async () => {
  const csp = (await get('/')).headers.get('content-security-policy') ?? '';
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*(?:https?:|\/\/)/i);
});

test('C21 app.js uses safe DOM rendering and no HTML/eval sinks', () => {
  assert.match(app, /textContent/);
  assert.match(app, /createElement/);
  assert.match(app, /replaceChildren/);
  assert.doesNotMatch(app, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new\s+Function)\b/);
});

test('C22 client fetch stays on the evidence route and case selection is allowlisted', () => {
  assert.match(app, /fetch\("\.\/site-manifest\.json"/);
  assert.match(app, /fetch\("\.\/" \+ route/);
  assert.match(app, /const route = "cases\/" \+ safeCaseId \+ "\.json"/);
  assert.match(app, /readVerifiedJson\("test-discrimination-summary\.json"/);
  assert.match(app, /CatTestDiscriminationSummaryV3/);
  assert.match(app, /CAT PROPOSAL · NOT AN ACCEPTED SPECIFICATION/);
  assert.match(app, /\["CAT proposal", proposed\]/);
  assert.match(app, /cases\.some\(\(\[id\]\) => id === selected\[0\]\)/);
  assert.deepEqual(ids, ['node-cache-ttl-zero-001', 'h0-1-authority-preflight-001']);
});

test('Test Discrimination Summary and its six fixed evidence sources are served with manifest hashes', async () => {
  const reportResponse = await get('/test-discrimination-summary.json');
  assert.equal(reportResponse.status, 200);
  const report = await reportResponse.json();
  assert.equal(report.schema, 'CatTestDiscriminationSummaryV3');
  assert.equal(report.publicOracleStatus, 'WEAK');
  assert.deepEqual(report.controls.map((control: {id: string; v1: string; v2: string}) => [control.id, control.v1, control.v2]), [
    ['known-wrong', 'FAIL', 'FAIL'], ['known-good', 'PASS', 'PASS'], ['finite-expiry-survivor', 'PASS', 'FAIL'], ['equivalent', 'PASS', 'PASS'],
  ]);
  const manifest = await (await get('/site-manifest.json')).json();
  assert.equal(manifest.sourceCommit, execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim());
  for (const binding of report.sourceBindings) {
    const file = await get('/' + binding.path);
    assert.equal(file.status, 200);
    assert.equal(createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'), binding.sha256, binding.path);
  }
  assert.equal((await get('/sources/not-allowlisted.json')).status, 404);
});

test('C23 fixture contains no private paths or credential-like material', () => {
  const text = fixtureBytes.toString('utf8');
  assert.doesNotMatch(text, /[A-Za-z]:\\(?:Users|home)\\/i);
  assert.doesNotMatch(text, /\/home\/[^/\s]+/i);
  assert.doesNotMatch(text, /\.agent-runs[\\/]+[^"\s]*private/i);
  assert.doesNotMatch(text, /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i);
  assert.doesNotMatch(text, /reasoning_content\s*:/i);
});

test('C24 execution copy says isolated local Docker', () => {
  assert.match(app, /Isolated local Docker/);
  assert.match(app, /LOCAL_DOCKER_FALLBACK/);
});

test('P04 is omitted while strict source verification is unavailable', () => {
  assert.ok(!ids.includes('p04-good-control-001'));
  assert.doesNotMatch(app, /p04-good-control-001/);
  assert.doesNotMatch(app, /p04-good-control-001|Accepted · verified good control/);
  assert.match(app, /Recorded public evidence/);
});

test('C25 machine execution backend remains LOCAL_DOCKER_FALLBACK', () => {
  assert.equal(fixture.execution.backend, 'LOCAL_DOCKER_FALLBACK');
});

test('C26 Nebius is inference attribution, not candidate execution', () => {
  assert.equal(fixture.inference.provider, 'Nebius');
  assert.equal(fixture.execution.backend, 'LOCAL_DOCKER_FALLBACK');
});

test('C27 headline comes from the real public evidence', () => {
  assert.equal(fixture.case.headline, 'Existing tests were green. CAT still rejected the AI patch.');
  assert.match(app, /headline: value\.case\.headline/);
});

test('C28 gates render in evidence order', () => {
  assert.deepEqual(fixture.gates.map((gate: {id: string}) => gate.id), ['build', 'existing-suite', 'public-contract', 'public-oracle-v2']);
  assert.match(app, /gates: value\.gates\.map/);
  assert.match(app, /normalized\.gates\.forEach/);
});

test('C29 hidden verification is NOT CREATED, not FAIL', () => {
  assert.equal(fixture.hiddenVerification.state, 'NOT_CREATED');
  assert.match(app, /\{label: "Blinded verification", value: value\.hiddenVerification\.state\}/);
  assert.match(app, /Blinded verification[\s\S]{0,40}value/);
  assert.doesNotMatch(app, /hiddenVerification\.state[^;\n]*FAIL/);
});

test('C30 hashes have safe wrapping rules', () => {
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /word-break:\s*break-word/);
});

test('mobile evidence layouts collapse to an explicit shrink-safe column', () => {
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /\.contrast-grid,\s*\.comparison-grid,\s*\.insight-panel,\s*\.decision-panel,\s*\.provenance-list,\s*\.omitted-list\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('mobile grid and flex content can shrink inside their containers', () => {
  assert.match(css, /\.hero > \*[^}]*min-width:\s*0/);
  assert.match(css, /\.gate-copy\s*\{\s*min-width:\s*0/);
  assert.match(css, /\.provenance-item dd\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.command-row > \*\s*\{\s*min-width:\s*0/);
});

test('long technical values wrap without clipping', () => {
  assert.match(css, /\.provenance-value[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.command-row code[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.reason-codes li[^}]*overflow-wrap:\s*anywhere/);
});

test('mobile hero headline keeps an explicit fluid display size', () => {
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?h1\s*\{[^}]*font-size:\s*clamp\(/);
});

test('mobile decision stamp is contained and horizontal', () => {
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.decision-stamp\s*\{[^}]*display:\s*flex;[^}]*max-width:\s*none/);
});

test('mobile header stacks identity and keeps both metadata labels', () => {
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.topbar\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.topbar-meta\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(app, /element\("span", "VIEW"\)/);
  assert.match(app, /element\("div", "STATIC PUBLIC RECORDS", "topbar-meta"\)/);
});

test('design contract excludes gradients, glow, imports, and external fonts', () => {
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|conic-gradient|text-shadow|@import/i);
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|https?:\/\//i);
});

test('design contract provides responsive breakpoints and reduced motion', () => {
  for (const width of [840, 620, 380]) assert.match(css, new RegExp('@media\\s*\\(max-width:\\s*' + width + 'px\\)'));
  assert.match(css, /prefers-reduced-motion/);
});

test('design contract provides keyboard focus and usable targets', () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height:\s*44px/);
});

test('copy buttons use clipboard API and announce success or failure', () => {
  assert.match(app, /navigator\.clipboard\.writeText/);
  assert.match(app, /Copied/);
  assert.match(app, /Copy failed/);
  assert.match(app, /aria-live/);
});

test('raw evidence view is collapsed and uses text rendering', () => {
  assert.match(app, /raw-details/);
  assert.match(app, /rawJson/);
  assert.match(app, /element\("code", rawJson\)/);
});

test('client fails closed when evidence is unavailable or invalid', () => {
  assert.match(app, /Evidence could not be verified\./);
  assert.match(app, /throw new Error\("Unsupported public evidence schema"\)/);
  assert.match(app, /renderEvidence\(verified\.value, normalizeEvidence\(verified\.value\)/);
  assert.match(app, /app\.replaceChildren\(error\)/);
});

test('HEAD works for an allowlisted route', async () => {
  const response = await get('/healthz', {method: 'HEAD'});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});

test('DELETE is rejected on an allowlisted route', async () => {
  assert.equal((await get('/healthz', {method: 'DELETE'})).status, 405);
});

test('server routes are a fixed allowlist, not generic filesystem serving', () => {
  const source = readFileSync(new URL('../src/evidence/evidence-console-server.ts', import.meta.url), 'utf8');
  assert.match(source, /routes\.get\(pathname\)/);
  assert.doesNotMatch(source, /createReadStream|sendFile|express\.static/);
});

test('console validation loads only the two supported public fixtures', () => {
  validateEvidenceConsoleAssets();
  assert.deepEqual(ids, ['node-cache-ttl-zero-001', 'h0-1-authority-preflight-001']);
});

test('GET / and case-selected pages return the local HTML shell', async () => {
  for (const route of ['/', ...ids.map((id) => '/?case=' + id)]) {
    const response = await get(route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
  }
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<main\b/);
  assert.match(html, /Checking the public evidence package/);
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/app\.js"/);
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>|<style\b|style\s*=/i);
});

test('the default evidence endpoint remains the immutable rejected V1 object', async () => {
  const response = await get('/evidence.json');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).decision.decision, 'REJECTED');
  const selected = loadPublicDecisionCase(DEFAULT_PUBLIC_CASE_ID);
  const bytes = Buffer.from(await (await get('/evidence.json')).arrayBuffer()).toString('utf8');
  assert.equal(bytes, selected.publicJson);
});

test('all case JSON endpoints return the selected canonical public schema', async () => {
  for (const id of ids) {
    const selected = loadPublicDecisionCase(id);
    const route = '/evidence.json?case=' + encodeURIComponent(id);
    const response = await get(route);
    assert.equal(response.status, 200, id);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(Buffer.from(await response.arrayBuffer()).toString('utf8'), selected.publicJson, id);
    const evidence = await (await get(route)).json();
    assert.equal(evidence.case.id, id);
    assert.equal(evidence.schema ?? 'PublicEvidenceV1', id === DEFAULT_PUBLIC_CASE_ID ? 'PublicEvidenceV1' : evidence.schema);
  }
});

test('case file routes only serve the selected fixed public projection', async () => {
  for (const id of ids) {
    const selected = loadPublicDecisionCase(id);
    const response = await get('/cases/' + id + '.json');
    assert.equal(response.status, 200, id);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString('utf8'), selected.publicJson, id);
  }
  assert.equal((await get('/cases/unknown.json')).status, 404);
  assert.equal((await get('/cases/p04-good-control-001.json')).status, 404);
});

test('case selection, duplicate values, traversal, and unknown parameters fail closed', async () => {
  for (const invalid of [
    '/?case=unknown', '/?case=', '/?case=../package.json', '/?case=%2e%2e%2fpackage.json',
    '/?case=%252e%252e%252fpackage.json', '/?case=C%3A%5CWindows%5Cwin.ini', '/?case=%5C%5Cserver%5Cshare',
    '/?case=.agent-runs%2Fx', '/?case=.gortex%2Fx', '/?case=package.json',
    '/?view=other', '/?view=discrimination&view=discrimination', '/?case=node-cache-ttl-zero-001&view=discrimination',
    '/?case=node-cache-ttl-zero-001&case=p04-good-control-001', '/evidence.json?case=p04-good-control-001&case=p04-good-control-001',
    '/evidence.json?case=p04-good-control-001&debug=true',
  ]) {
    const response = await get(invalid);
    assert.ok(response.status === 400 || response.status === 404, `${invalid}: ${response.status}`);
    assert.doesNotMatch(await response.text(), /package\.json|agent-runs|gortex|private/i);
  }
});

test('fixed routes preserve 404, HEAD, and 405 behavior', async () => {
  assert.equal((await get('/unknown')).status, 404);
  assert.equal((await get('/package.json')).status, 404);
  assert.equal((await get('/.agent-runs/private.json')).status, 404);
  assert.equal((await get('/.gortex/config')).status, 404);
  const head = await get('/evidence.json', {method: 'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await get('/?case=h0-1-authority-preflight-001', {method: 'POST'});
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('CSP and same-origin security headers remain on every response', async () => {
  for (const route of ['/', '/evidence.json', '/healthz']) {
    const response = await get(route);
    for (const header of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'cache-control']) assert.ok(response.headers.has(header), header);
    const csp = response.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/i);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  }
});

test('selector is a labelled native keyboard control with touch-safe responsive styling', () => {
  assert.match(app, /element\("label"/);
  assert.match(app, /document\.createElement\("select"\)/);
  assert.match(app, /aria-label", "Select report or public evidence case"/);
  assert.match(app, /option\.selected = activeView === option\.value/);
  assert.match(app, /select\.addEventListener\("change"/);
  assert.match(css, /\.case-selector select[^}]*min-height:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(max-width:\s*620px\)[\s\S]*?\.case-selector select\s*\{\s*width:\s*100%/);
  assert.match(css, /prefers-reduced-motion/);
});

test('renderer labels only evidence that is present in public records', () => {
  assert.match(app, /PublicAuthorityPreflightV1/);
  assert.match(app, /The recorded public behavior gates found a contradiction\./);
  assert.match(app, /The preflight stopped because authority was ambiguous\./);
  assert.match(app, /AUTOMATION STOPPED/);
  assert.match(app, /Execution: NOT RUN/);
  assert.doesNotMatch(app, /execution failure/i);
});

test('client uses text-only DOM rendering and verifies allowlisted public assets', () => {
  assert.match(app, /textContent/);
  assert.match(app, /createElement/);
  assert.match(app, /replaceChildren/);
  assert.doesNotMatch(app, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new\s+Function)\b/);
  assert.match(app, /fetch\("\.\/" \+ route/);
  assert.match(app, /fetch\("\.\/site-manifest\.json"/);
  assert.match(app, /readVerifiedJson\("test-discrimination-summary\.json"/);
  assert.match(app, /cases\.some\(\(\[id\]\) => id === selected\[0\]\)/);
  assert.match(app, /Evidence could not be verified\./);
});

test('console CLI accepts default and every allowlisted case, rejecting malformed IDs', () => {
  const script = 'scripts/cat-evidence-console.ts';
  assert.match(execFileSync(process.execPath, ['--experimental-strip-types', script, '--check'], {cwd: process.cwd(), encoding: 'utf8'}), /CHECK=PASS/);
  for (const id of ids) assert.match(execFileSync(process.execPath, ['--experimental-strip-types', script, '--check', '--case', id], {cwd: process.cwd(), encoding: 'utf8'}), /CHECK=PASS/);
  for (const args of [['--case', 'unknown'], ['--case', '../package.json'], ['--case', ''], ['--case', 'p04-good-control-001', '--case', 'h0-1-authority-preflight-001']]) {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {cwd: process.cwd(), encoding: 'utf8'});
    assert.equal(result.status, 2);
    assert.match(result.stderr, /CAT_EVIDENCE_CONSOLE=ERROR/);
    assert.doesNotMatch(result.stderr, /package\.json|agent-runs|gortex/i);
  }
});
