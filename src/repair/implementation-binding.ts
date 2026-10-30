import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const OBJECT_ID = /^[a-f0-9]{40,64}$/;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// Keep this runtime closure explicit. Update it whenever cat:repair gains a local import.
export const P05_IMPLEMENTATION_FILES = [
  'package.json',
  'scripts/cat-repair.ts',
  'scripts/cat-repair-runner.cjs',
  'src/oracle/canonical.ts',
  'src/oracle/evaluate.ts',
  'src/repair/candidate.ts',
  'src/repair/execution.ts',
  'src/repair/implementation-binding.ts',
  'src/repair/milestone.ts',
  'src/repair/model-response.ts',
  'src/repair/production-lifecycle.ts',
  'src/repair/provider.ts',
  'src/repair/receipt-v5.ts',
  'src/repair/repair-projection.ts',
  'src/runtime/nebius.ts',
  'src/verifier/holdout-generator.ts',
  'src/verifier/sealed-verifier.ts',
] as const;

export type ImplementationBinding = {
  implementationSha: string;
  implementationTreeSha: string;
  implementationFiles: {path: string; sha256: string}[];
};

export type ImplementationSource = {
  head(): string;
  tree(head: string): string;
  branch(): string;
  remoteHead(branch: string): string;
  isTracked(path: string): boolean;
  committedBytes(head: string, path: string): Buffer | null;
  workingBytes(path: string): Buffer | null;
  untrackedPaths(): string[];
};

export function assertP05ImplementationBinding(source: ImplementationSource, expectedBranch: string): ImplementationBinding {
  const implementationSha = source.head();
  if (!OBJECT_ID.test(implementationSha)) throw new Error('IMPLEMENTATION_HEAD_INVALID');
  if (source.branch() !== expectedBranch) throw new Error('IMPLEMENTATION_BRANCH_MISMATCH');
  if (source.remoteHead(expectedBranch) !== implementationSha) throw new Error('IMPLEMENTATION_REMOTE_BINDING_MISMATCH');
  if (source.untrackedPaths().some((file) => {
    const normalized = file.replace(/\\/g, '/');
    return normalized.startsWith('src/repair/') || normalized.startsWith('scripts/cat-repair');
  })) throw new Error('IMPLEMENTATION_UNTRACKED_SHADOW');

  const implementationFiles = P05_IMPLEMENTATION_FILES.map((file) => {
    if (!source.isTracked(file)) throw new Error('IMPLEMENTATION_FILE_UNTRACKED');
    const committed = source.committedBytes(implementationSha, file);
    const working = source.workingBytes(file);
    if (!committed || !working) throw new Error('IMPLEMENTATION_FILE_MISSING');
    const committedSha256 = sha256(committed);
    const workingSha256 = sha256(working);
    if (workingSha256 !== committedSha256) throw new Error('IMPLEMENTATION_FILE_MODIFIED');
    return {path: file, sha256: committedSha256};
  });
  const implementationTreeSha = source.tree(implementationSha);
  if (!OBJECT_ID.test(implementationTreeSha)) throw new Error('IMPLEMENTATION_TREE_INVALID');
  return {implementationSha, implementationTreeSha, implementationFiles};
}

export function gitImplementationSource(repositoryRoot: string): ImplementationSource {
  const run = (args: string[]) => execFileSync('git', args, {cwd: repositoryRoot, windowsHide: true});
  const text = (args: string[]) => run(args).toString('utf8').trim();
  return {
    head: () => text(['rev-parse', 'HEAD']),
    tree: (head) => text(['rev-parse', `${head}^{tree}`]),
    branch: () => text(['branch', '--show-current']),
    remoteHead: (branch) => text(['rev-parse', `origin/${branch}`]),
    isTracked: (file) => {
      try { run(['ls-files', '--error-unmatch', '--', file]); return true; }
      catch { return false; }
    },
    committedBytes: (head, file) => {
      try { return run(['cat-file', 'blob', `${head}:${file}`]); }
      catch { return null; }
    },
    workingBytes: (file) => {
      try { return readFileSync(path.join(repositoryRoot, ...file.split('/'))); }
      catch { return null; }
    },
    untrackedPaths: () => text(['ls-files', '--others']).split(/\r?\n/).filter(Boolean),
  };
}
