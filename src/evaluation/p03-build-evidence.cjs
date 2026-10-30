'use strict';
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const FILES = ['index.js', 'lib/node_cache.js'];
const VERSIONS = Object.freeze({v3: '3.2.1', v4: '4.0.0'});
const NORMALIZER_ID = 'node-cache-banner-date-v1';
function fail() { throw new Error('BUILD_METADATA_NORMALIZATION_UNSAFE'); }
function text(bytes) {
  if (!Buffer.isBuffer(bytes)) fail();
  const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes)) fail();
  return value;
}
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function hydrateFrozenBytes(bytes) {
  const value = text(bytes);
  if (/\r(?!\n)/.test(value)) fail();
  return Buffer.from(value.replace(/\r\n/g, '\n'), 'utf8');
}
function normalizeBuildBytes(bytes, version) {
  if (!Object.values(VERSIONS).includes(version)) fail();
  const value = text(bytes);
  const bannerEnd = value.indexOf('*/\n');
  if (bannerEnd < 0) fail();
  const banner = value.slice(0, bannerEnd + 3);
  const lines = banner.split('\n');
  const versionLine = new RegExp('^ \\* node-cache ' + escapeRegExp(version) + ' \\( (\\d{4}-\\d{2}-\\d{2}) \\)$').exec(lines[1] || '');
  const dates = banner.match(/\d{4}-\d{2}-\d{2}/g) || [];
  if (!versionLine || dates.length !== 1 || !validDate(versionLine[1])) fail();
  const expected = ['/*', ' * node-cache ' + version + ' ( ' + versionLine[1] + ' )', ' * https://github.com/tcs-de/nodecache', ' *',
    ' * Released under the MIT license', ' * https://github.com/tcs-de/nodecache/blob/master/LICENSE', ' * ',
    ' * Maintained by M. Peter ( https://github.com/mpneuried )', '*/', ''].join('\n');
  if (banner !== expected) fail();
  const dateOffset = value.indexOf(versionLine[1], value.indexOf('\n') + 1);
  return Buffer.from(value.slice(0, dateOffset) + '<BUILD_DATE>' + value.slice(dateOffset + versionLine[1].length), 'utf8');
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function rows(files, version, normalize = false) {
  return FILES.map((name) => ({path: name, sha256: sha256(normalize ? normalizeBuildBytes(files[name], version) : files[name])}));
}
function artifactHash(runtimeRows) { return sha256(canonical(runtimeRows)); }
function readRuntime(dir) { return Object.fromEntries(FILES.map((name) => [name, fs.readFileSync(path.join(dir, name))])); }
function frozenRuntime(dir, version) {
  const source = readRuntime(dir);
  const files = Object.fromEntries(FILES.map((name) => [name, hydrateFrozenBytes(source[name])]));
  return {files, rawRows: rows(files, version), normalizedRows: rows(files, version, true)};
}
function rebuiltRuntime(dir, version) {
  const files = readRuntime(dir);
  return {files, rawRows: rows(files, version), normalizedRows: rows(files, version, true)};
}
function createBuildEvidence(sourceTreeSha256, frozen, rebuilt, buildEnvironment) {
  const frozenRuntimeRawSha256 = Object.fromEntries(Object.keys(VERSIONS).map((key) => [key, artifactHash(frozen[key].rawRows)]));
  const rebuiltRuntimeRawSha256 = Object.fromEntries(Object.keys(VERSIONS).map((key) => [key, artifactHash(rebuilt[key].rawRows)]));
  const normalizedFrozenSha256 = Object.fromEntries(Object.keys(VERSIONS).map((key) => [key, artifactHash(frozen[key].normalizedRows)]));
  const normalizedRebuiltSha256 = Object.fromEntries(Object.keys(VERSIONS).map((key) => [key, artifactHash(rebuilt[key].normalizedRows)]));
  return {version: 2, sourceTreeSha256, frozenRuntimeRawSha256, rebuiltRuntimeRawSha256, normalizedFrozenSha256, normalizedRebuiltSha256,
    buildCommand: 'node node_modules/grunt-cli/bin/grunt build --no-color', buildEnvironment,
    normalizer: {id: NORMALIZER_ID, fieldsNormalized: FILES.length * Object.keys(VERSIONS).length},
    semanticParity: Object.keys(VERSIONS).every((key) => normalizedFrozenSha256[key] === normalizedRebuiltSha256[key])};
}
function validBuildEvidence(evidence) {
  try {
    if (evidence?.version !== 2 || evidence?.normalizer?.id !== NORMALIZER_ID || evidence?.normalizer?.fieldsNormalized !== 4 ||
      evidence?.buildCommand !== 'node node_modules/grunt-cli/bin/grunt build --no-color' || evidence?.semanticParity !== true) return false;
    for (const key of Object.keys(VERSIONS)) {
      for (const group of ['sourceTreeSha256', 'frozenRuntimeRawSha256', 'rebuiltRuntimeRawSha256', 'normalizedFrozenSha256', 'normalizedRebuiltSha256']) {
        if (!/^[a-f0-9]{64}$/.test(evidence[group]?.[key] || '')) return false;
      }
      if (evidence.normalizedFrozenSha256[key] !== evidence.normalizedRebuiltSha256[key]) return false;
    }
    return evidence.buildEnvironment && typeof evidence.buildEnvironment === 'object';
  } catch { return false; }
}
module.exports = {FILES, VERSIONS, NORMALIZER_ID, artifactHash, canonical, createBuildEvidence, frozenRuntime, hydrateFrozenBytes,
  normalizeBuildBytes, rebuiltRuntime, sha256, validBuildEvidence};
