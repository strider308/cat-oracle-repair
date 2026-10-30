import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRepairRequestPackage, REPAIR_RESPONSE_SCHEMA} from '../src/repair/model-response.ts';
import {APPROVED_REPAIR_MODEL_ID} from '../src/repair/provider.ts';
import {createRepairProjection} from '../src/repair/repair-projection.ts';
import {createInferenceAuthorizationProposal} from '../src/runtime/inference-authorization.ts';
import {buildTokenFactoryRepairBody, buildTokenFactorySmokeBody, resolveTokenFactoryBaseUrl} from '../src/runtime/nebius.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const purpose = args[0];
const operationId = args[1];
const accountReference = process.env.CAT_NEBIUS_ACCOUNT_REFERENCE?.trim() ?? '';
const timeoutMs = Number(process.env.CAT_INFERENCE_TIMEOUT_MS ?? (purpose === 'repair' ? '180000' : '15000'));

function required(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

let projection: ReturnType<typeof createRepairProjection> | undefined;
try {
  required(purpose === 'repair' || purpose === 'smoke', 'USAGE: npm run cat:inference-authorization-proposal -- <repair|smoke> <operation-uuid>');
  required(/^[a-f0-9-]{36}$/i.test(operationId ?? ''), 'INFERENCE_OPERATION_ID_INVALID');
  required(Boolean(accountReference), 'CAT_NEBIUS_ACCOUNT_REFERENCE_REQUIRED');
  required(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 180000, 'CAT_INFERENCE_TIMEOUT_INVALID');

  const model = APPROVED_REPAIR_MODEL_ID;
  const baseUrl = resolveTokenFactoryBaseUrl(process.env.CAT_TOKEN_FACTORY_BASE_URL ?? 'https://api.tokenfactory.us-central1.nebius.com/v1/');
  let body: string;
  let packageSha256: string;
  let maxOutputTokens: number;
  let requestPackageBytes: string | undefined;
  if (purpose === 'smoke') {
    body = buildTokenFactorySmokeBody(model);
    packageSha256 = createHash('sha256').update(body).digest('hex');
    maxOutputTokens = 256;
  } else {
    projection = createRepairProjection(ROOT);
    const manifest = projection.result.manifest as any;
    const byPath = new Map<string, any>(manifest.files.map((item: any) => [item.path, item]));
    const target = byPath.get('candidate/_src/lib/node_cache.coffee');
    const contract = byPath.get('candidate/contract-v3.json');
    const oracle = byPath.get('candidate/oracle-v2.json');
    required(Boolean(target && contract && oracle), 'REPAIR_REQUEST_BINDING_INVALID');
    const contextFiles = manifest.files.map((file: any) => ({
      path: file.path, sha256: file.sha256, role: file.role,
      content: readFileSync(path.join(projection!.workspacePath, ...file.path.split('/')), 'utf8'),
    }));
    const requestPackage = createRepairRequestPackage({caseId: manifest.caseId, model,
      manifestHash: projection.result.manifestHash, workspaceHash: manifest.workspaceHash,
      publicContractHash: contract.sha256, publicOracleHash: oracle.sha256, baseSha256: target.sha256, contextFiles});
    body = buildTokenFactoryRepairBody(model, requestPackage.bytes, REPAIR_RESPONSE_SCHEMA as unknown as Record<string, unknown>);
    packageSha256 = requestPackage.sha256;
    maxOutputTokens = 12000;
    requestPackageBytes = requestPackage.bytes;
  }

  const proposal = createInferenceAuthorizationProposal({operationId: operationId!, purpose, endpoint: new URL('chat/completions', baseUrl).toString(), model,
    body, packageSha256, accountReference, timeoutMs, maxOutputTokens, maxResponseBytes: 1024 * 1024}, randomUUID(), operationId!, ROOT);
  const artifactDir = path.join(ROOT, '.verification-runs', `inference-approval-${randomUUID()}`);
  mkdirSync(artifactDir, {recursive: true});
  if (requestPackageBytes) writeFileSync(path.join(artifactDir, 'sanitized-request-package.json'), requestPackageBytes, {flag: 'wx'});
  writeFileSync(path.join(artifactDir, 'authorization-proposal.json'), `${JSON.stringify(proposal, null, 2)}\n`, {flag: 'wx'});
  process.stdout.write(`CAT_INFERENCE_AUTHORIZATION=NOT_AUTHORIZED\nCAT_INFERENCE_PURPOSE=${purpose}\nCAT_INFERENCE_OPERATION_ID=${operationId}\n${requestPackageBytes ? `CAT_INFERENCE_PACKAGE=${path.join(artifactDir, 'sanitized-request-package.json')}\n` : ''}CAT_INFERENCE_PROPOSAL=${path.join(artifactDir, 'authorization-proposal.json')}\nCAT_INFERENCE_PACKAGE_SHA256=${packageSha256}\nCAT_INFERENCE_BODY_SHA256=${createHash('sha256').update(body).digest('hex')}\n`);
} catch (error) {
  process.stderr.write(`CAT_INFERENCE_AUTHORIZATION_PROPOSAL=BLOCKED:${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}\n`);
  process.exitCode = 1;
} finally { projection?.cleanup(); }
