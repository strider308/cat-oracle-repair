import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUTH_DIR = path.join(ROOT, '.agent-runs', 'inference-authorizations');
export const INFERENCE_OPTION_B_RISK = 'Option B: accepts residual billing risk for exactly one request; any cost estimate is not a guaranteed ceiling; no provider-enforced hard cap is asserted.';
export const INFERENCE_IMPLEMENTATION_FILES = [
  'scripts/cat-repair.ts', 'scripts/cat-smoke.ts', 'scripts/cat-inference-authorization-proposal.ts', 'src/repair/provider.ts',
  'src/repair/model-response.ts', 'src/runtime/inference-authorization.ts', 'src/runtime/nebius.ts',
];
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export type InferenceAuthorizationRequest = {
  operationId: string;
  purpose: 'repair' | 'smoke';
  endpoint: string;
  model: string;
  body: string;
  packageSha256: string;
  accountReference: string;
  timeoutMs: number;
  maxOutputTokens: number;
  maxResponseBytes: number;
};

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {cwd: root, windowsHide: true}).toString('utf8').trim();
}

function implementationIdentity(root: string) {
  if (git(root, ['status', '--porcelain=v1', '--untracked-files=all'])) throw new Error('INFERENCE_SOURCE_DIRTY');
  const commit = git(root, ['rev-parse', 'HEAD']);
  const tree = git(root, ['rev-parse', `${commit}^{tree}`]);
  const branch = git(root, ['branch', '--show-current']);
  const remoteName = git(root, ['config', '--get', `branch.${branch}.remote`]);
  if (!remoteName || remoteName === '.') throw new Error('INFERENCE_REMOTE_AUTHORITY_MISSING');
  const remoteUrl = git(root, ['remote', 'get-url', remoteName]);
  const remoteRef = `refs/remotes/${remoteName}/${branch}`;
  const remoteHead = git(root, ['rev-parse', '--verify', remoteRef]);
  if (remoteHead !== commit) throw new Error('INFERENCE_REMOTE_HEAD_MISMATCH');
  const implementationFiles = INFERENCE_IMPLEMENTATION_FILES.map((file) => {
    const working = readFileSync(path.join(root, ...file.split('/')));
    return {path: file, sha256: hash(working)};
  });
  return {commit, tree, branch, remoteName, remoteUrl, remoteRef, remoteHead, implementationFiles};
}

function authorizationExpectation(request: InferenceAuthorizationRequest, record: Record<string, any>, root: string) {
  const bodyBytes = Buffer.from(request.body, 'utf8');
  return {
    version: 1, status: 'approved', authorizationId: record.authorizationId,
    operationId: request.operationId, purpose: request.purpose, ...implementationIdentity(root),
    accountReference: request.accountReference, endpoint: request.endpoint, method: 'POST', model: request.model,
    bodySha256: hash(bodyBytes), packageSha256: request.packageSha256, bodyBytes: bodyBytes.length,
    timeoutMs: request.timeoutMs, maxOutputTokens: request.maxOutputTokens, maxResponseBytes: request.maxResponseBytes,
    authorizedPostCount: 1, financialOption: 'B', financialRiskStatement: INFERENCE_OPTION_B_RISK, residualBillingRiskAccepted: true,
  };
}

export function createInferenceAuthorizationProposal(request: InferenceAuthorizationRequest, authorizationId: string, operationId: string, repositoryRoot = ROOT) {
  if (request.operationId !== operationId) throw new Error('INFERENCE_AUTHORIZATION_OPERATION_MISMATCH');
  return {...authorizationExpectation(request, {authorizationId, operationId}, repositoryRoot), status: 'pending',
    authorizationId, operationId, ownerReference: '', approvedAt: '', expiresAt: '',
    authorizedPostCount: 0, residualBillingRiskAccepted: false};
}

export function consumeInferenceAuthorization(request: InferenceAuthorizationRequest, authorizationFile: string | undefined, repositoryRoot = ROOT): void {
  // Local approval files cannot authenticate an owner or resist rollback; fail closed until external authorities exist.
  throw new Error('INFERENCE_AUTHENTICATED_OWNER_APPROVAL_UNAVAILABLE');
}
