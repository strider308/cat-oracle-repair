const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const canonical = (value) => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);
function treeInventory(root) {
  const rows = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (entry.isSymbolicLink()) throw new Error('SOURCE_SYMLINK_REJECTED');
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) rows.push({path: relative, sha256: sha256(fs.readFileSync(file))});
      else throw new Error('SOURCE_FILE_TYPE_REJECTED');
    }
  };
  visit(root);
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return rows;
}

const mount = process.argv[2];
const kind = process.argv[3];
const frozenMount = process.argv[4];
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
let packageDir = mount;
let runtime;
let sourceTreeSha256 = null;

if (kind === 'upstream-v3' || kind === 'upstream-v4') {
  const rows = treeInventory(mount);
  sourceTreeSha256 = sha256(canonical(rows));
  if (typeof frozenMount !== 'string' || !frozenMount.startsWith('/frozen')) throw new Error('FROZEN_RUNTIME_REQUIRED');
  packageDir = frozenMount;
  runtime = ['index.js', 'lib/node_cache.js'].map((name) => ({path: name, sha256: sha256(fs.readFileSync(path.join(packageDir, name)))}));
} else if (kind === 'node-cache') {
  runtime = [{path: 'index.js', sha256: sha256(fs.readFileSync(path.join(mount, 'index.js')))}];
} else throw new Error('CANDIDATE_KIND_INVALID');

const Cache = require(packageDir);
const cache = new Cache({stdTTL: 0, checkperiod: 0});
cache.set(input.key, input.value, input.initialTtlSeconds);
const ttlReturned = cache.ttl(input.key, input.updatedTtlSeconds);
const value = cache.get(input.key);
const expiry = cache.getTtl(input.key);
const observation = {ttlReturned, found: value !== undefined, value: value === undefined ? null : value, expiresAt: expiry === undefined ? null : expiry};
cache.close();
process.stdout.write(JSON.stringify({observation, runtime, sourceTreeSha256}) + '\n');
