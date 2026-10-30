import {createHash} from 'node:crypto';
import {canonical} from '../oracle/canonical.ts';
import {normalizeProjectionPath, workspaceHashForFiles} from './repair-projection.ts';

// Proposal paths are relative to candidateRoot, never to the projection workspace.
export const REPAIR_MODIFIABLE_PATH = '_src/lib/node_cache.coffee';
export const REPAIR_RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['path', 'baseSha256', 'replacementText'],
  properties: {
    path: {type: 'string', const: REPAIR_MODIFIABLE_PATH},
    baseSha256: {type: 'string', pattern: '^[a-f0-9]{64}$'},
    replacementText: {type: 'string', minLength: 1, maxLength: 65536},
  },
} as const;

export const GENERATED_CONTEXT_OMISSIONS = {
  'candidate/index.js': 'candidate-runtime',
  'candidate/lib/node_cache.js': 'candidate-runtime',
  'candidate/test/node_cache-test.js': 'public-test',
  'candidate/test/test-expire.js': 'public-test',
} as const;
const CONTEXT_ROLES = new Set(['candidate-source', 'candidate-runtime', 'candidate-metadata', 'build-metadata', 'public-test', 'contract', 'public-witness', 'public-oracle', 'build-instructions', 'public-suite-result']);

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export type RepairProposal = {path: typeof REPAIR_MODIFIABLE_PATH; baseSha256: string; replacementText: string};

export function createRepairRequestPackage(input: {caseId: string; model: string; manifestHash: string; workspaceHash: string; publicContractHash: string; publicOracleHash: string; baseSha256: string; contextFiles: {path: string; sha256: string; role: string; content: string}[]; version?: 1 | 2}) {
  const version = input.version ?? 2;
  if (input.caseId !== 'node-cache-ttl-zero-001' || !input.model.trim() ||
      ![input.manifestHash, input.workspaceHash, input.publicContractHash, input.publicOracleHash, input.baseSha256].every((v) => /^[a-f0-9]{64}$/.test(v))) {
    throw new Error('REPAIR_REQUEST_BINDING_INVALID');
  }
  const paths = input.contextFiles.map((file) => normalizeProjectionPath(file.path));
  const contextHash = workspaceHashForFiles(input.contextFiles.map(({path, sha256: digest, role}) => ({path, sha256: digest, role})));
  const badFile = input.contextFiles.some((file) => !/^[a-f0-9]{64}$/.test(file.sha256) ||
    !CONTEXT_ROLES.has(file.role) || file.path !== normalizeProjectionPath(file.path) ||
    sha256(file.content) !== file.sha256);
  const invalidContext = input.contextFiles.length !== 15 || new Set(paths).size !== paths.length || badFile || contextHash !== input.workspaceHash ||
    input.contextFiles.find((file) => file.path === `candidate/${REPAIR_MODIFIABLE_PATH}`)?.sha256 !== input.baseSha256 ||
    input.contextFiles.find((file) => file.path === 'candidate/contract-v3.json')?.sha256 !== input.publicContractHash ||
    input.contextFiles.find((file) => file.path === 'candidate/oracle-v2.json')?.sha256 !== input.publicOracleHash;
  if (invalidContext) throw new Error('REPAIR_REQUEST_CONTEXT_INVALID');
  const publicContextFiles = input.contextFiles.map(({path, sha256: digest, role, content}) => {
    const omit = version === 2 && Object.hasOwn(GENERATED_CONTEXT_OMISSIONS, path) && GENERATED_CONTEXT_OMISSIONS[path as keyof typeof GENERATED_CONTEXT_OMISSIONS] === role;
    return omit ? {path, sha256: digest, role, contentOmitted: true} : {path, sha256: digest, role, content};
  });
  const value = {
    version, caseId: input.caseId, model: input.model, projectionManifestHash: input.manifestHash,
    workspaceHash: input.workspaceHash, modifiablePaths: [REPAIR_MODIFIABLE_PATH],
    publicContractHash: input.publicContractHash, publicOracleHash: input.publicOracleHash,
    instructions: 'Repair the supplied node-cache candidate so ttl(key, 0) on an existing valid entry preserves the key and results in no expiry, while preserving all other supplied contractual behavior. Replace only the exact allowed source file. Do not modify tests, requirements, evaluation machinery, dependencies, or build policy.',
    generation: {temperature: 0, maxTokens: 12000, responseSchema: REPAIR_RESPONSE_SCHEMA},
    baseFileSha256: input.baseSha256,
    publicContextFiles,
  };
  const bytes = canonical(value);
  return {value, bytes, sha256: sha256(bytes)};
}

export function verifyRepairRequestContext(request: unknown, projectionManifest: unknown): void {
  if (!record(request) || !record(projectionManifest) || !Array.isArray(request.publicContextFiles) ||
      !Array.isArray(projectionManifest.files) || projectionManifest.caseId !== request.caseId ||
      sha256(canonical(projectionManifest)) !== request.projectionManifestHash ||
      request.workspaceHash !== projectionManifest.workspaceHash || request.publicContextFiles.length !== 15 || projectionManifest.files.length !== 15 ||
      ![1, 2].includes(request.version as number)) throw new Error('REPAIR_REQUEST_CONTEXT_INVALID');
  const rows = request.publicContextFiles as Record<string, unknown>[];
  const manifestRows = projectionManifest.files as Record<string, unknown>[];
  const manifestHashRows = manifestRows.map((item) => ({path: item.path, sha256: item.sha256, role: item.role}));
  if (workspaceHashForFiles(manifestHashRows as {path: string; sha256: string; role: string}[]) !== request.workspaceHash) throw new Error('REPAIR_REQUEST_CONTEXT_INVALID');
  let omittedCount = 0;
  for (let index = 0; index < rows.length; index++) {
    const item = rows[index];
    const source = manifestRows[index];
    if (!record(item) || item.path !== source.path || item.sha256 !== source.sha256 || item.role !== source.role ||
        typeof item.path !== 'string' || normalizeProjectionPath(item.path) !== item.path ||
        typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) || typeof item.role !== 'string' || !CONTEXT_ROLES.has(item.role)) {
      throw new Error('REPAIR_REQUEST_CONTEXT_INVALID');
    }
    const omitted = Object.hasOwn(item, 'contentOmitted');
    if (request.version === 1) {
      if (omitted || Object.keys(item).sort().join('|') !== 'content|path|role|sha256' ||
          typeof item.content !== 'string' || sha256(item.content) !== item.sha256) throw new Error('REPAIR_REQUEST_CONTEXT_INVALID');
      continue;
    }
    const expectedOmission = Object.hasOwn(GENERATED_CONTEXT_OMISSIONS, item.path as string) &&
      GENERATED_CONTEXT_OMISSIONS[item.path as keyof typeof GENERATED_CONTEXT_OMISSIONS] === item.role;
    if (omitted !== expectedOmission) throw new Error('REPAIR_REQUEST_CONTEXT_OMISSION_INVALID');
    if (omitted) {
      if (item.contentOmitted !== true || Object.keys(item).sort().join('|') !== 'contentOmitted|path|role|sha256' ||
          !Object.hasOwn(GENERATED_CONTEXT_OMISSIONS, item.path as string) ||
          GENERATED_CONTEXT_OMISSIONS[item.path as keyof typeof GENERATED_CONTEXT_OMISSIONS] !== item.role) throw new Error('REPAIR_REQUEST_CONTEXT_OMISSION_INVALID');
      omittedCount++;
    } else if (Object.keys(item).sort().join('|') !== 'content|path|role|sha256' ||
        typeof item.content !== 'string' || sha256(item.content) !== item.sha256) throw new Error('REPAIR_REQUEST_CONTEXT_INVALID');
  }
  if ((request.version === 2 && omittedCount === 0) ||
      workspaceHashForFiles(rows.map(({path, sha256: digest, role}) => ({path: path as string, sha256: digest as string, role: role as string}))) !== request.workspaceHash ||
      rows.find((item) => item.path === `candidate/${REPAIR_MODIFIABLE_PATH}`)?.sha256 !== request.baseFileSha256 ||
      rows.find((item) => item.path === 'candidate/contract-v3.json')?.sha256 !== request.publicContractHash ||
      rows.find((item) => item.path === 'candidate/oracle-v2.json')?.sha256 !== request.publicOracleHash) throw new Error('REPAIR_REQUEST_CONTEXT_INVALID');
}

export function validateRepairProposal(raw: string, expectedBaseSha256: string): {proposal: RepairProposal; validatedSha256: string} {
  if (Buffer.byteLength(raw, 'utf8') > 131072 || !/^[a-f0-9]{64}$/.test(expectedBaseSha256)) throw new Error('REPAIR_RESPONSE_SIZE_OR_BASE_INVALID');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('REPAIR_RESPONSE_JSON_INVALID'); }
  if (!record(value) || Object.keys(value).sort().join('|') !== 'baseSha256|path|replacementText' ||
      value.path !== REPAIR_MODIFIABLE_PATH || value.baseSha256 !== expectedBaseSha256 || typeof value.replacementText !== 'string' ||
      !value.replacementText.trim() || Buffer.byteLength(value.replacementText, 'utf8') > 65536 || value.replacementText.includes('\0') ||
      value.replacementText.includes('\uFFFD')) throw new Error('REPAIR_RESPONSE_SCHEMA_INVALID');
  const normalized = value.replacementText.replace(/\r\n/g, '\n');
  const proposal = {path: REPAIR_MODIFIABLE_PATH, baseSha256: expectedBaseSha256, replacementText: normalized};
  return {proposal, validatedSha256: sha256(canonical(proposal))};
}
