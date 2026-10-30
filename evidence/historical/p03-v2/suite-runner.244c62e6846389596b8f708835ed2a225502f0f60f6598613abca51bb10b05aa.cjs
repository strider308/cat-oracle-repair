const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

const root = '/tmp/cat-p03';
const maxBuffer = 65536;
const timeout = 60000;
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const canonical = (value) => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);
const sourceTreeHash = (dir) => {
  const rows = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const file = path.join(current, entry.name);
      const relative = path.relative(dir, file).split(path.sep).join('/');
      if (entry.isSymbolicLink()) throw new Error('SOURCE_SYMLINK_REJECTED');
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) rows.push({path: relative, sha256: sha256(fs.readFileSync(file))});
      else throw new Error('SOURCE_FILE_TYPE_REJECTED');
    }
  };
  visit(dir);
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return sha256(canonical(rows));
};
const runtime = (dir) => ['index.js', 'lib/node_cache.js'].map((name) => {
  const bytes = fs.readFileSync(path.join(dir, name));
  return {path: name, sha256: sha256(bytes)};
});
const run = (cwd, args) => {
  const result = spawnSync(process.execPath, args, {
    cwd, env: {PATH: process.env.PATH, NODE_PATH: '/deps/node_modules', HOME: '/tmp/cat-p03'}, encoding: null,
    timeout, maxBuffer, windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.signal || result.status === null) throw new Error('SUITE_PROCESS_INCONCLUSIVE');
  return {exitCode: result.status, stdout: result.stdout || Buffer.alloc(0), stderr: result.stderr || Buffer.alloc(0)};
};
const mkdirClean = (dir) => fs.mkdirSync(dir, {recursive: true});
const suiteRoot = path.join(root, 'suite');
mkdirClean(root);
const v3SourceTreeSha256 = sourceTreeHash('/case/suite/source');
const v4SourceTreeSha256 = sourceTreeHash('/case/upstream/4.0.0');
fs.cpSync('/case/suite/source', suiteRoot, {recursive: true, filter: (source) => !source.includes('node_modules')});
fs.symlinkSync('/deps/node_modules', path.join(suiteRoot, 'node_modules'), 'dir');
const v3Build = run(suiteRoot, ['node_modules/grunt-cli/bin/grunt', 'build', '--no-color']);
const v3Runtime = runtime(suiteRoot);
const testRun = v3Build.exitCode === 0
  ? run(suiteRoot, ['node_modules/expresso/bin/expresso', 'test/node_cache-test.js'])
  : {exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('build failed')};

const v4Root = path.join(root, 'v4');
mkdirClean(v4Root);
fs.cpSync('/case/upstream/4.0.0', v4Root, {recursive: true});
fs.symlinkSync('/deps/node_modules', path.join(v4Root, 'node_modules'), 'dir');
const v4Build = run(v4Root, ['node_modules/grunt-cli/bin/grunt', 'build', '--no-color']);
const v4Runtime = (v4Build.exitCode === 0 && fs.existsSync(path.join(v4Root, 'index.js'))) ? runtime(v4Root) : [];
const stdout = Buffer.concat([v3Build.stdout, testRun.stdout, v4Build.stdout]);
const stderr = Buffer.concat([v3Build.stderr, testRun.stderr, v4Build.stderr]);
const testText = (testRun.stdout.toString('utf8') + testRun.stderr.toString('utf8')).replace(/\u001b\[[0-9;]*m/g, '');
const match = testText.match(/\b100%\s+(\d+)\s+tests?\b/);
const testsPassed = testRun.exitCode === 0 && match ? Number(match[1]) : 0;
const result = {
  candidateCommit: 'bc49b373396cdbe4c1de612b866b4fece4c8471e',
  knownGoodCommit: '59d947471d0dcc2d305d1675e80c04e4a598cc86',
  command: 'node node_modules/grunt-cli/bin/grunt build && node node_modules/expresso/bin/expresso test/node_cache-test.js',
  candidateBuildCommand: 'node node_modules/grunt-cli/bin/grunt build --no-color',
  buildExitCode: v3Build.exitCode,
  exitCode: testRun.exitCode,
  testsPassed,
  testsFailed: testsPassed === 8 ? 0 : 8 - testsPassed,
  v3Runtime,
  v3SourceTreeSha256,
  v4BuildExitCode: v4Build.exitCode,
  v4BuildOut: v4Build.stdout.toString('utf8').slice(-500),
  v4BuildErr: v4Build.stderr.toString('utf8').slice(-500),
  v4Files: fs.readdirSync(v4Root),
  v4Runtime,
  v4SourceTreeSha256,
  stdoutBytes: stdout.length,
  stderrBytes: stderr.length,
  stdoutHash: sha256(stdout),
  stderrHash: sha256(stderr),
  result: testRun.exitCode === 0 && testsPassed === 8 && v3Build.exitCode === 0 && v4Build.exitCode === 0 ? 'PASS' : 'FAIL',
};
process.stdout.write(JSON.stringify(result) + '\n');
if (result.result !== 'PASS') process.exitCode = 1;
