import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, readdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {buildStaticConsole} from '../scripts/cat-console-static.ts';

const root = process.cwd();
test('static Console exports historical and executable evidence with a hash manifest', () => {
  const output = path.join(root, '.verification-runs', `test-static-console-${randomUUID()}`);
  try {
    const built = buildStaticConsole(output, root);
    const expected = ['_headers', 'app.js', 'cases', 'executions', 'index.html', 'site-manifest.json', 'sources', 'styles.css', 'test-discrimination-summary.json'];
    assert.deepEqual(readdirSync(output).sort(), expected.sort());
    assert.deepEqual(readdirSync(path.join(output, 'cases')).sort(), ['h0-1-authority-preflight-001.json', 'node-cache-ttl-zero-001.json']);
    assert.deepEqual(readdirSync(path.join(output, 'sources')).sort(), [
      'approved-behavior.json', 'oracle-v1.json', 'oracle-v2.json', 'p03-candidate-executions.json', 'p03-oracle-attack.json', 'p03-suite-evidence.json',
    ]);
    assert.equal(built.p04SourceVerification, 'CASE_OMITTED_STRICT_VERIFICATION_UNAVAILABLE');
    const manifest = JSON.parse(readFileSync(path.join(output, 'site-manifest.json'), 'utf8'));
    assert.equal(manifest.sourceCommit, execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim());
    const report = JSON.parse(readFileSync(path.join(output, 'test-discrimination-summary.json'), 'utf8'));
    assert.equal(report.packageSourceSha, manifest.sourceCommit);
    assert.equal(report.publicOracleStatus, 'WEAK');
    assert.equal(report.historicalP03.archivedReceiptVerification, 'HISTORICAL_INCOMPLETE');
    assert.deepEqual(readdirSync(path.join(output, 'executions')).sort(), report.executableOracleRepairs.map(({receiptFile}: any) => receiptFile.slice('executions/'.length)).sort());
    const app = readFileSync(path.join(output, 'app.js'), 'utf8');
    assert.match(app, /Combined decision/);
    assert.match(app, /Ordinary suite PASS; the bypass survived/);
    assert.match(app, /generated and ran response ===/);
    assert.match(app, /good\/equivalent ACCEPT, survivor REJECT/);
    assert.match(app, /PUBLIC ORACLE STATUS.*WEAK/s);
    assert.match(app, /not Docker-sealed/);
    for (const item of manifest.files) {
      const bytes = readFileSync(path.join(output, ...item.path.split('/')));
      assert.equal(bytes.byteLength, item.bytes, item.path);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, item.path);
    }
    assert.match(readFileSync(path.join(output, '_headers'), 'utf8'), /Content-Security-Policy/);
  } finally {
    rmSync(output, {recursive: true, force: true});
  }
});
