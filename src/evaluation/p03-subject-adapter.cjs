const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);

const root = process.argv[2];
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
if (!request || !Array.isArray(request.runtimeRows) || !request.input || typeof request.entrypoint !== 'string') throw new Error('SUBJECT_REQUEST_INVALID');
const rows = [...request.runtimeRows].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
if (canonical(rows) !== canonical(request.runtimeRows)) throw new Error('SUBJECT_RUNTIME_ROWS_INVALID');
const allowed = new Set();
for (const row of rows) {
  if (!row || typeof row.path !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256) || path.isAbsolute(row.path) ||
      row.path.split('/').some((part) => !part || part === '.' || part === '..') || row.path.includes('\\')) throw new Error('SUBJECT_RUNTIME_ROWS_INVALID');
  const file = path.join(root, ...row.path.split('/'));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || sha256(fs.readFileSync(file)) !== row.sha256) throw new Error('SUBJECT_RUNTIME_HASH_MISMATCH');
  allowed.add(path.resolve(file));
}
const entrypoint = path.resolve(root, ...request.entrypoint.split('/'));
if (!allowed.has(entrypoint)) throw new Error('SUBJECT_ENTRYPOINT_UNBOUND');

const originalLoad = Module._load;
Module._load = function(requested, parent, isMain) {
  if (parent?.filename && parent.filename.startsWith(root + path.sep) && !Module.isBuiltin(requested)) {
    let resolved;
    try { resolved = Module._resolveFilename(requested, parent, isMain); }
    catch { throw new Error('SUBJECT_RUNTIME_BOUNDARY_UNRESOLVED'); }
    if (!allowed.has(path.resolve(resolved))) throw new Error('SUBJECT_RUNTIME_BOUNDARY_UNRESOLVED');
  }
  return originalLoad.call(this, requested, parent, isMain);
};

const Cache = require(entrypoint);
const cache = new Cache({stdTTL: 0, checkperiod: 0});
cache.set(request.input.key, request.input.value, request.input.initialTtlSeconds);
const ttlReturned = cache.ttl(request.input.key, request.input.updatedTtlSeconds);
const value = cache.get(request.input.key);
const expiry = cache.getTtl(request.input.key);
const observation = {ttlReturned, found: value !== undefined, value: value === undefined ? null : value, expiresAt: expiry === undefined ? null : expiry};
cache.close();
process.stdout.write(JSON.stringify({observation, runtimeHash: sha256(Buffer.from(canonical(rows))), runtimeFileCount: rows.length}) + '\n');
