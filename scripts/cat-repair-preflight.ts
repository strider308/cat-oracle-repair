import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRepairProjection} from '../src/repair/repair-projection.ts';
import {createRepairRequestPackage, REPAIR_RESPONSE_SCHEMA} from '../src/repair/model-response.ts';
import {APPROVED_REPAIR_MODEL_ID, MAX_REPAIR_PACKAGE_BYTES} from '../src/repair/provider.ts';
import {buildTokenFactoryRepairBody} from '../src/runtime/nebius.ts';

const root = process.cwd();
const jsonMode = process.argv.includes('--json');
let projection: ReturnType<typeof createRepairProjection> | undefined;
try {
  projection = createRepairProjection(root);
  const {manifest, manifestHash, sensitiveChecks, leakage} = projection.result;
  const target = manifest.files.find((item) => item.path === 'candidate/_src/lib/node_cache.coffee');
  const contract = manifest.files.find((item) => item.path === 'candidate/contract-v3.json');
  const oracle = manifest.files.find((item) => item.path === 'candidate/oracle-v2.json');
  if (!target || !contract || !oracle) throw new Error('REPAIR_REQUEST_BINDING_INVALID');
  const contextFiles = manifest.files.map((file) => ({...file,
    content: readFileSync(path.join(projection!.workspacePath, ...file.path.split('/')), 'utf8')}));
  const requestPackage = createRepairRequestPackage({caseId: manifest.caseId, model: APPROVED_REPAIR_MODEL_ID, manifestHash,
    workspaceHash: manifest.workspaceHash, publicContractHash: contract.sha256, publicOracleHash: oracle.sha256,
    baseSha256: target.sha256, contextFiles});
  const body = buildTokenFactoryRepairBody(APPROVED_REPAIR_MODEL_ID, requestPackage.bytes,
    REPAIR_RESPONSE_SCHEMA as unknown as Record<string, unknown>);
  if (Buffer.byteLength(requestPackage.bytes) > MAX_REPAIR_PACKAGE_BYTES) throw new Error('REPAIR_REQUEST_PACKAGE_TOO_LARGE');
  const request = {version: requestPackage.value.version, bytes: Buffer.byteLength(requestPackage.bytes), sha256: requestPackage.sha256,
    httpBodyBytes: Buffer.byteLength(body), httpBodySha256: createHash('sha256').update(body).digest('hex'),
    omittedContents: requestPackage.value.publicContextFiles.filter((item: any) => item.contentOmitted).map((item: any) => item.path)};
  const result = {status: 'PASS', manifestVersion: manifest.version, fileCount: manifest.files.length,
    workspaceHash: manifest.workspaceHash, manifestHash, request, sensitiveChecks, leakage};
  if (jsonMode) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else process.stdout.write([
    'CAT_P05_REPAIR_PREFLIGHT=PASS',
    'CAT_P05_MANIFEST_VERSION=' + manifest.version,
    'CAT_P05_PROJECTED_FILE_COUNT=' + manifest.files.length,
    'CAT_P05_REQUEST_VERSION=' + request.version,
    'CAT_P05_REQUEST_PACKAGE_BYTES=' + request.bytes,
    'CAT_P05_REQUEST_PACKAGE_SHA256=' + request.sha256,
    'CAT_P05_HTTP_BODY_BYTES=' + request.httpBodyBytes,
    'CAT_P05_HTTP_BODY_SHA256=' + request.httpBodySha256,
    ...request.omittedContents.map((file) => `CAT_P05_OMITTED_GENERATED_CONTENT=${file}`),
    'CAT_P05_WORKSPACE_HASH=' + manifest.workspaceHash,
    'CAT_P05_MANIFEST_HASH=' + manifestHash,
    ...sensitiveChecks.map(({id, hashMatch}) => `CAT_P05_DENYLIST_${id}=${hashMatch ? 'MATCH' : 'NO_MATCH'}`),
    ...Object.entries(leakage).map(([key, value]) => `CAT_P05_LEAKAGE_${key.toUpperCase()}=${value}`),
  ].join('\n') + '\n');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(jsonMode ? JSON.stringify({status: 'BLOCKED', error: message}) + '\n' : 'CAT_P05_REPAIR_PREFLIGHT=BLOCKED:' + message + '\n');
  process.exitCode = 1;
} finally {
  projection?.cleanup();
}
