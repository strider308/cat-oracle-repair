import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {P05_IMPLEMENTATION_FILES, type ImplementationSource} from './implementation-binding.ts';

export const P05_SUCCESSOR_BINDING_VERSION = 2;
export const P05_SUCCESSOR_IMPLEMENTATION_FILES = [
  ...P05_IMPLEMENTATION_FILES, 'scripts/cat-smoke.ts', 'scripts/cat-inference-authorization-proposal.ts',
  'src/runtime/inference-authorization.ts', 'src/repair/implementation-binding-v2.ts',
] as const;

export type P05SuccessorSource = ImplementationSource & {
  remoteHeadFor(remote: string, branch: string): string;
  remoteUrl(remote: string): string;
  workingTreeClean(): boolean;
};

export type P05SuccessorBinding = {
  version: typeof P05_SUCCESSOR_BINDING_VERSION;
  sourceSha: string;
  sourceTreeSha: string;
  branch: string;
  remoteName: string;
  remoteUrl: string;
  remoteRef: string;
  remoteHead: string;
  implementationFiles: {path: string; sha256: string}[];
  implementationFilesSha256: string;
};

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const objectId = /^[a-f0-9]{40,64}$/;

export function prepareP05ImplementationBindingV2(source: P05SuccessorSource, repositoryRoot: string, remoteName: string): P05SuccessorBinding {
  if (!source.workingTreeClean()) throw new Error('IMPLEMENTATION_V2_DIRTY_TREE');
  const branch = source.branch();
  const sourceSha = source.head();
  const sourceTreeSha = source.tree(sourceSha);
  const remoteUrl = source.remoteUrl(remoteName);
  const remoteHead = source.remoteHeadFor(remoteName, branch);
  if (!objectId.test(sourceSha) || !objectId.test(sourceTreeSha) || remoteHead !== sourceSha || !remoteUrl.trim()) {
    throw new Error('IMPLEMENTATION_V2_REMOTE_AUTHORITY_MISMATCH');
  }
  if (source.untrackedPaths().some((file) => file.startsWith('src/repair/') || file.startsWith('scripts/cat-repair') || file.startsWith('src/runtime/'))) {
    throw new Error('IMPLEMENTATION_V2_UNTRACKED_SHADOW');
  }
  const implementationFiles = P05_SUCCESSOR_IMPLEMENTATION_FILES.map((file) => {
    if (!source.isTracked(file)) throw new Error('IMPLEMENTATION_V2_FILE_UNTRACKED');
    const committed = source.committedBytes(sourceSha, file);
    const working = source.workingBytes(file);
    if (!committed || !working) throw new Error('IMPLEMENTATION_V2_FILE_MISSING');
    return {path: file, sha256: digest(committed)};
  });
  const implementationFilesSha256 = digest(JSON.stringify(implementationFiles));
  return {version: P05_SUCCESSOR_BINDING_VERSION, sourceSha, sourceTreeSha, branch, remoteName, remoteUrl,
    remoteRef: `refs/remotes/${remoteName}/${branch}`, remoteHead, implementationFiles, implementationFilesSha256};
}

export function assertP05ImplementationBindingV2(source: P05SuccessorSource, repositoryRoot: string, remoteName: string, approval: unknown) {
  const binding = prepareP05ImplementationBindingV2(source, repositoryRoot, remoteName);
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) throw new Error('IMPLEMENTATION_V2_OWNER_APPROVAL_REQUIRED');
  const value = approval as Record<string, unknown>;
  const fields: (keyof P05SuccessorBinding)[] = ['version', 'sourceSha', 'sourceTreeSha', 'branch', 'remoteName', 'remoteUrl', 'remoteRef', 'remoteHead', 'implementationFilesSha256'];
  if (value.status !== 'approved' || typeof value.ownerReference !== 'string' || !value.ownerReference.trim() ||
      typeof value.approvedAt !== 'string' || !Number.isFinite(Date.parse(value.approvedAt)) ||
      fields.some((field) => value[field] !== binding[field])) throw new Error('IMPLEMENTATION_V2_OWNER_APPROVAL_MISMATCH');
  return binding;
}

export function gitP05SuccessorSource(repositoryRoot: string): P05SuccessorSource {
  const run = (args: string[]) => execFileSync('git', args, {cwd: repositoryRoot, windowsHide: true});
  const text = (args: string[]) => run(args).toString('utf8').trim();
  return {
    head: () => text(['rev-parse', 'HEAD']),
    tree: (head) => text(['rev-parse', `${head}^{tree}`]),
    branch: () => text(['branch', '--show-current']),
    remoteHead: (branch) => text(['rev-parse', `origin/${branch}`]),
    remoteHeadFor: (remote, branch) => text(['rev-parse', '--verify', `refs/remotes/${remote}/${branch}`]),
    remoteUrl: (remote) => text(['remote', 'get-url', remote]),
    workingTreeClean: () => text(['status', '--porcelain=v1', '--untracked-files=all']) === '',
    isTracked: (file) => { try { run(['ls-files', '--error-unmatch', '--', file]); return true; } catch { return false; } },
    committedBytes: (head, file) => { try { return run(['cat-file', 'blob', `${head}:${file}`]); } catch { return null; } },
    workingBytes: (file) => { try { return readFileSync(path.join(repositoryRoot, ...file.split('/'))); } catch { return null; } },
    untrackedPaths: () => text(['ls-files', '--others']).split(/\r?\n/).filter(Boolean),
  };
}
