import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {canonical} from '../oracle/canonical.ts';

const CASE = 'fixtures/hero/node-cache-ttl-zero-001';
const ALLOWLIST = [
  ['suite/source/_src/index.coffee', 'candidate-source'],
  ['suite/source/_src/lib/node_cache.coffee', 'candidate-source'],
  ['suite/source/_src/test/node_cache-test.coffee', 'public-test'],
  ['suite/source/_src/test/test-expire.coffee', 'public-test'],
  ['suite/source/index.js', 'candidate-runtime'],
  ['suite/source/lib/node_cache.js', 'candidate-runtime'],
  ['suite/source/test/node_cache-test.js', 'public-test'],
  ['suite/source/test/test-expire.js', 'public-test'],
  ['suite/source/package.json', 'candidate-metadata'],
  ['suite/source/Gruntfile.coffee', 'build-metadata'],
  ['contract-v3.json', 'contract'],
  ['witness.json', 'public-witness'],
  ['oracle-v2.json', 'public-oracle'],
] as const;

export const SENSITIVE_ARTIFACT_DENYLIST = [
  {id: 'KNOWN_GOOD_SOURCE', sha256: '2b5819050c06c30f6b60e58cc30e2beae05efb2b4742689f862551a1da34f95b'},
  {id: 'KNOWN_GOOD_RUNTIME_INDEX', sha256: '01db186f5322f7646549f5e3e9258f835da2c51ac7933715c386c9b586c5095b'},
  {id: 'KNOWN_GOOD_RUNTIME_LIBRARY', sha256: 'd3f7530d20553871abc050bb99b77175a56715c45ed97d2f9ce621f548a736a6'},
  {id: 'KNOWN_GOOD_RUNTIME_FROZEN_INDEX', sha256: '1f1a1b70f8b5ca46a70c7c1b29e8acc84ae82e7ac88c26caada3863de9daf095'},
  {id: 'KNOWN_GOOD_RUNTIME_FROZEN_LIBRARY', sha256: '9fe726ef8dece7acae8f4c6eca2044e577a699cd0ce94c9ef5a39bfe59c549d4'},
  {id: 'EQUIVALENT_SOLUTION', sha256: 'a2edbc7a5b1f182c8f348231b6b8d8b76427211ca115fd054a93455f290963b4'},
  {id: 'EQUIVALENT_SOLUTION_RECORDED', sha256: '22b241b1a9b9469f81bb5cee6ecbd0b0da72fcf8aac77846856802519176be73'},
] as const;

const REPAIR_ENV_ALLOWLIST: readonly string[] = Object.freeze([]);
const SENSITIVE_ENV_NAMES = ['NEBIUS_API_KEY', 'NEBIUS_IAM_TOKEN', 'NEBIUS_SANDBOX_IAM_TOKEN', 'NEBIUS_PROJECT_ID', 'CAT_HOLDOUT_SEED', 'CAT_HOLDOUT_PATH', 'CAT_HOLDOUT_CONTENT'];

export function createRepairExecutionPlan(workspacePath: string, hostEnvironment: NodeJS.ProcessEnv = process.env) {
  const environment = Object.fromEntries(REPAIR_ENV_ALLOWLIST.filter((name) => hostEnvironment[name] !== undefined).map((name) => [name, hostEnvironment[name]!]));
  const excludedSensitiveNames = SENSITIVE_ENV_NAMES.filter((name) => Object.hasOwn(hostEnvironment, name));
  if (SENSITIVE_ENV_NAMES.some((name) => Object.hasOwn(environment, name))) throw new Error('REPAIR_ENVIRONMENT_LEAK');
  return {workspaceMount: {source: workspacePath, target: '/workspace', readOnly: true}, environment,
    excludedSensitiveNames, networkAccess: false, dockerControl: false,
    mounts: [{source: workspacePath, target: '/workspace', readOnly: true, kind: 'repair-workspace'}]};
}

const BUILD_INSTRUCTIONS = 'Build the node-cache candidate with: node node_modules/grunt-cli/bin/grunt build --no-color\nRun the existing public suite with: node node_modules/expresso/bin/expresso test/node_cache-test.js\n';
const EXTRA_FILES = [{path: 'public/BUILD.txt', role: 'build-instructions', bytes: Buffer.from(BUILD_INSTRUCTIONS)}];

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const within = (root: string, target: string) => {
  const rel = path.relative(root, target);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
};

export function normalizeProjectionPath(input: string) {
  if (typeof input !== 'string' || !input || input.includes('\\') || input.startsWith('/') || input.startsWith('//') || /^[a-z]:/i.test(input) || input.includes(':')) throw new Error('PROJECTION_PATH_INVALID');
  const parts = input.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\u0000-\u001f]/.test(part))) throw new Error('PROJECTION_PATH_INVALID');
  const normalized = parts.join('/');
  if (/(^|\/)\.git(\/|$)/i.test(normalized) || /(^|\/)(?:historical|sealed|private|holdout)(\/|$)/i.test(normalized) || normalized.includes('4.0.0') || /(^|\/)equivalent(\/|$)/i.test(normalized)) throw new Error('PROJECTION_PATH_FORBIDDEN');
  return normalized;
}

export function validateProjectionPaths(paths: string[]) {
  const normalized = paths.map(normalizeProjectionPath);
  if (new Set(normalized).size !== normalized.length) throw new Error('PROJECTION_PATH_DUPLICATE');
  return normalized;
}

export function resolveAllowlistedSource(approvedRootPath: string, relative: string) {
  const safeRelative = normalizeProjectionPath(relative);
  const approvedRoot = realpathSync(approvedRootPath);
  const source = path.join(approvedRoot, ...safeRelative.split('/'));
  const resolved = realpathSync(source);
  if (!within(approvedRoot, resolved)) throw new Error('PROJECTION_SOURCE_ESCAPE');
  let current = approvedRoot;
  for (const segment of safeRelative.split('/')) {
    current = path.join(current, segment);
    const info = lstatSync(current);
    if (info.isSymbolicLink()) throw new Error('PROJECTION_SOURCE_LINK_REJECTED');
  }
  if (!lstatSync(resolved).isFile()) throw new Error('PROJECTION_SOURCE_NOT_FILE');
  return resolved;
}

function sourceFile(root: string, relative: string) {
  return resolveAllowlistedSource(path.join(root, CASE), relative);
}

function inventory(workspace: string) {
  const rows: {path: string; sha256: string; bytes: number; role: string}[] = [];
  const walk = (dir: string) => {
    for (const item of readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, item.name);
      const relative = normalizeProjectionPath(path.relative(workspace, full).split(path.sep).join('/'));
      const info = lstatSync(full);
      if (item.isSymbolicLink() || info.isSymbolicLink()) throw new Error('PROJECTION_LINK_REJECTED');
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) {
        const bytes = readFileSync(full);
        const sha256 = digest(bytes);
        if (SENSITIVE_ARTIFACT_DENYLIST.some((artifact) => artifact.sha256 === sha256)) throw new Error('PROJECTION_SENSITIVE_HASH_MATCH');
        const role = rows.find((row) => row.path === relative)?.role;
        rows.push({path: relative, sha256, bytes: bytes.length, role: role ?? 'public-evidence'});
      } else throw new Error('PROJECTION_FILE_TYPE_REJECTED');
    }
  };
  walk(workspace);
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (new Set(rows.map((row) => row.path)).size !== rows.length) throw new Error('PROJECTION_PATH_DUPLICATE');
  return rows;
}

export function workspaceHashForFiles(files: {path: string; sha256: string; role: string}[]) {
  const canonicalRows = [...files].map(({path, sha256, role}) => ({path: normalizeProjectionPath(path), sha256, role}))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (new Set(canonicalRows.map((row) => row.path)).size !== canonicalRows.length || canonicalRows.some((row) => !/^[a-f0-9]{64}$/.test(row.sha256))) throw new Error('PROJECTION_MANIFEST_INVALID');
  return digest(canonical(canonicalRows));
}

export function createRepairProjection(repositoryRoot: string) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cat-p05-repair-'));
  try {
    if (readdirSync(tempRoot).length !== 0) throw new Error('PROJECTION_ROOT_NOT_EMPTY');
    const sourceManifest = JSON.parse(readFileSync(path.join(repositoryRoot, CASE, 'manifest.json'), 'utf8'));
    const suite = sourceManifest.existingSuite;
    if (sourceManifest.caseId !== 'node-cache-ttl-zero-001' || suite?.testsPassed !== 8 || suite?.testsFailed !== 0 || suite?.exitCode !== 0) throw new Error('PUBLIC_SUITE_EVIDENCE_INVALID');
    const extraFiles = [...EXTRA_FILES, {path: 'public/existing-suite-result.json', role: 'public-suite-result',
      bytes: Buffer.from(JSON.stringify({version: 1, candidate: 'node-cache-3.2.1', suite: 'existing public suite', testsPassed: suite.testsPassed, testsFailed: suite.testsFailed, exitCode: suite.exitCode}, null, 2) + '\n')}];
    const roleByPath = new Map<string, string>();
    const outputPaths = validateProjectionPaths([
      ...ALLOWLIST.map(([source]) => 'candidate/' + source.replace('suite/source/', '')),
      ...extraFiles.map(({path}) => path),
    ]);
    for (const [index, [sourceRelative, role]] of ALLOWLIST.entries()) {
      const outputPath = outputPaths[index];
      roleByPath.set(outputPath, role);
      const source = sourceFile(repositoryRoot, sourceRelative);
      const target = path.join(tempRoot, ...outputPath.split('/'));
      mkdirSync(path.dirname(target), {recursive: true});
      cpSync(source, target, {dereference: false, errorOnExist: true, force: false});
    }
    for (const [index, entry] of extraFiles.entries()) {
      const outputPath = outputPaths[ALLOWLIST.length + index];
      roleByPath.set(outputPath, entry.role);
      const target = path.join(tempRoot, ...outputPath.split('/'));
      mkdirSync(path.dirname(target), {recursive: true});
      writeFileSync(target, entry.bytes, {flag: 'wx', mode: 0o600});
    }
    const rows = inventory(tempRoot).map((row) => ({...row, role: roleByPath.get(row.path) ?? row.role}));
    const candidateRows = rows.filter((row) => row.role === 'candidate-source' || row.role === 'candidate-runtime' || row.role === 'candidate-metadata' || row.role === 'build-metadata');
    const baseCandidateHash = digest(canonical(candidateRows.map(({path, sha256, role}) => ({path, sha256, role}))));
    const workspaceHash = workspaceHashForFiles(rows);
    const gitProbe = spawnSync('git', ['-C', tempRoot, 'rev-parse', '--is-inside-work-tree'], {encoding: 'utf8', windowsHide: true,
      env: {PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? {SystemRoot: process.env.SystemRoot} : {})}});
    if (gitProbe.error) throw new Error('GIT_HISTORY_PROBE_UNAVAILABLE');
    const gitAccessible = gitProbe.status === 0 && gitProbe.stdout.trim() === 'true';
    const dockerControlArtifact = rows.some((row) => /(^|\/)(?:docker\.sock|docker_engine|docker\.pipe)$/i.test(row.path));
    const executionPlan = createRepairExecutionPlan(tempRoot, process.env);
    const environmentBoundaryPass = SENSITIVE_ENV_NAMES.every((name) => !Object.hasOwn(executionPlan.environment, name));
    const manifest = {version: 1, caseId: 'node-cache-ttl-zero-001', baseCandidateId: 'node-cache-3.2.1', baseCandidateHash,
      files: rows, publicEvidence: rows.filter((row) => !candidateRows.includes(row)).map(({path, sha256, role}) => ({path, sha256, role})), workspaceHash,
      executionBoundary: {environmentNames: Object.keys(executionPlan.environment), workspaceMountReadOnly: executionPlan.workspaceMount.readOnly,
        networkAccess: executionPlan.networkAccess, dockerControl: executionPlan.dockerControl, mountTargets: executionPlan.mounts.map(({target}) => target)}};
    const manifestHash = digest(canonical(manifest));
    const sensitiveChecks = SENSITIVE_ARTIFACT_DENYLIST.map(({id, sha256}) => ({id, hashMatch: rows.some((row) => row.sha256 === sha256)}));
    if (sensitiveChecks.some((check) => check.hashMatch)) throw new Error('PROJECTION_SENSITIVE_HASH_MATCH');
    const excluded = !rows.some((row) => /(^|\/)\.git(\/|$)|(^|\/)(?:historical|sealed|private|holdout)(\/|$)|4\.0\.0|(^|\/)equivalent(\/|$)/i.test(row.path));
    if (!excluded || existsSync(path.join(tempRoot, '.git'))) throw new Error('PROJECTION_PATH_LEAK');
    const hasDockerMount = executionPlan.dockerControl || executionPlan.mounts.length !== 1 || executionPlan.mounts.some(({source, target, readOnly, kind}) => source !== tempRoot || target !== '/workspace' || !readOnly || kind !== 'repair-workspace') || /docker(?:\.sock|_engine|\.pipe)|\\\\\.\\pipe/i.test(executionPlan.workspaceMount.source);
    const leakage = {knownGoodSource: 'PASS', knownGoodRuntime: 'PASS', equivalentImplementation: 'PASS', futureGitHistory: gitAccessible ? 'FAIL' : 'PASS', gitMetadata: existsSync(path.join(tempRoot, '.git')) ? 'FAIL' : 'PASS', privateOrSealedEvidence: 'PASS', holdout: 'PASS', sensitiveEnvironment: environmentBoundaryPass ? 'PASS' : 'FAIL', dockerSocket: !executionPlan.dockerControl && !hasDockerMount && !dockerControlArtifact ? 'PASS' : 'FAIL'};
    if (Object.values(leakage).some((value) => value !== 'PASS')) throw new Error('PROJECTION_LEAKAGE_CHECK_FAILED');
    const result = {manifest, manifestHash, sensitiveChecks, leakage};
    return {workspacePath: tempRoot, result, cleanup: () => rmSync(tempRoot, {recursive: true, force: true})};
  } catch (error) {
    rmSync(tempRoot, {recursive: true, force: true});
    throw error;
  }
}
