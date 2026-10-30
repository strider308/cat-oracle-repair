const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const runtimeHash = () => hash(JSON.stringify(['index.js', 'lib/node_cache.js'].map((name) => ({path: name, sha256: hash(readFileSync(path.join('/candidate', name)))}))));
const operation = process.argv[2];
const commands = {
  build: [process.execPath, '/deps/node_modules/grunt-cli/bin/grunt', 'build', '--no-color'],
  suite: [process.execPath, '/deps/node_modules/expresso/bin/expresso', 'test/node_cache-test.js'],
};
let result;
if (commands[operation]) {
  const child = spawnSync(commands[operation][0], commands[operation].slice(1), {cwd: '/candidate', encoding: 'utf8', timeout: 60000, maxBuffer: 262144, windowsHide: true, env: {PATH: process.env.PATH, NODE_PATH: '/deps/node_modules', HOME: '/tmp', TMPDIR: '/tmp'}});
  const stdout = Buffer.from(child.stdout ?? '');
  const stderr = Buffer.from(child.stderr ?? '');
  const operational = !!child.error && ['ENOENT', 'ETIMEDOUT', 'ENOBUFS'].includes(child.error.code);
  result = {operation, exitCode: Number.isInteger(child.status) ? child.status : 1, operational,
    stdoutBytes: stdout.length, stderrBytes: stderr.length, outputSha256: hash(Buffer.concat([stdout, Buffer.from('\0'), stderr])),
    runtimeSha256: safeRuntimeHash()};
} else if (operation === 'observe') {
  const observer = `const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');const h=b=>crypto.createHash('sha256').update(b).digest('hex');const r=h(JSON.stringify(['index.js','lib/node_cache.js'].map(p=>({path:p,sha256:h(fs.readFileSync(path.join('/candidate',p)))}))));const i=JSON.parse(fs.readFileSync(0,'utf8'));const startedAt=Date.now();const C=require('/candidate'),c=new C({stdTTL:0,checkperiod:0});c.set(i.key,i.value,i.initialTtlSeconds);const t=c.ttl(i.key,i.updatedTtlSeconds),v=c.get(i.key),e=c.getTtl(i.key);c.close();const finishedAt=Date.now();process.stdout.write(JSON.stringify({runtimeSha256:r,observationStartedAt:startedAt,observationFinishedAt:finishedAt,observation:{ttlReturned:t,found:v!==undefined,value:v===undefined?null:v,expiresAt:e===undefined?null:e}})+'\\n');`;
  const child = spawnSync(process.execPath, ['-e', observer], {cwd: '/candidate', input: readFileSync(0), encoding: 'utf8', timeout: 15000, maxBuffer: 65536, windowsHide: true, env: {PATH: process.env.PATH, NODE_PATH: '/deps/node_modules', HOME: '/tmp', TMPDIR: '/tmp'}});
  const stdout = child.stdout ?? '';
  const stderr = child.stderr ?? '';
  const outputSha256 = hash(Buffer.concat([Buffer.from(stdout), Buffer.from('\0'), Buffer.from(stderr)]));
  let parsed;
  if (!child.error && child.status === 0) {
    try { const lines = stdout.trim().split(/\r?\n/); if (lines.length !== 1) throw new Error(); parsed = JSON.parse(lines[0]); } catch { parsed = undefined; }
  }
  result = {operation, exitCode: child.status === 0 && parsed ? 0 : 1, operational: false, outputSha256,
    runtimeSha256: parsed?.runtimeSha256 ?? safeRuntimeHash(), observationStartedAt: parsed?.observationStartedAt ?? null,
    observationFinishedAt: parsed?.observationFinishedAt ?? null, observation: parsed?.observation ?? null};
} else result = {operation, exitCode: 1, operational: true, outputSha256: hash('INVALID_OPERATION'), runtimeSha256: hash('')};

function safeRuntimeHash() { try { return runtimeHash(); } catch { return hash('RUNTIME_MISSING'); } }
process.stdout.write(JSON.stringify(result) + '\n');
