import {existsSync, lstatSync, realpathSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {buildRejectedHeroPublicEvidence, formatPublicEvidenceSummary, serializePublicEvidenceV1} from '../src/evidence/public-evidence-v1.ts';

const args = process.argv.slice(2);
const summary = args.includes('--summary');
const outputAt = args.indexOf('--output');
if (args.filter((arg) => arg === '--summary').length > 1 || args.filter((arg) => arg === '--output').length > 1 ||
    args.some((arg, index) => arg !== '--summary' && arg !== '--output' && index !== outputAt + 1) ||
    outputAt !== -1 && (args.length !== outputAt + 2 || !args[outputAt + 1])) {
  throw new Error('Usage: cat-public-evidence.ts [--summary] [--output <path>]');
}
if (summary && outputAt !== -1) throw new Error('--summary and --output cannot be combined');

const evidence = buildRejectedHeroPublicEvidence({
  candidateHash: '143ccb56526e031511a693f2be5d01d1c4ceac915195835c7703b8f4e244b43c',
  operationId: null,
  executionBackend: 'LOCAL_DOCKER_FALLBACK',
  sandboxStatus: 'CLIENT_UNAVAILABLE',
});
const content = summary ? formatPublicEvidenceSummary(evidence) : serializePublicEvidenceV1(evidence);
if (outputAt === -1) {
  process.stdout.write(content);
} else {
  const requested = path.resolve(args[outputAt + 1]);
  const relative = path.relative(process.cwd(), requested).split(path.sep);
  if (relative.some((part) => ['.agent-runs', '.gortex'].includes(part.toLowerCase()))) throw new Error('Protected output path');
  let current = path.parse(path.dirname(requested)).root;
  for (const part of path.dirname(requested).slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Output path cannot use a symbolic link or junction');
  }
  const parent = realpathSync(path.dirname(requested));
  if (parent.split(path.sep).some((part) => ['.agent-runs', '.gortex'].includes(part.toLowerCase())) || existsSync(requested)) throw new Error('Output must be new and outside protected directories');
  writeFileSync(path.join(parent, path.basename(requested)), content, {flag: 'wx'});
}
