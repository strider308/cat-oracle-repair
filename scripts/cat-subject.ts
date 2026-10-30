import {runP03SubjectEvaluation} from '../src/evaluation/p03-subject.ts';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createControlledBenchmarkReceipt, verifyControlledBenchmarkReceipt} from '../src/benchmark/controlled-subject-profile.ts';
import {verifyControlledCandidate} from '../src/benchmark/controlled-candidate-generator.ts';

const args = process.argv.slice(2);
const manifestIndex = args.indexOf('--candidate-manifest');
const manifestPath = manifestIndex >= 0 ? args[manifestIndex + 1] : undefined;
const freezeCommitIndex = args.indexOf('--freeze-commit');
const freezeCommitSha = freezeCommitIndex >= 0 ? args[freezeCommitIndex + 1] : undefined;
const generationIndex = args.indexOf('--generation-evidence');
const generationPath = generationIndex >= 0 ? args[generationIndex + 1] : undefined;
const challengeIndex = args.indexOf('--challenge-manifest');
const challengePath = challengeIndex >= 0 ? args[challengeIndex + 1] : undefined;
const sourceIndex = args.indexOf('--candidate-source');
const sourcePath = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined;
const runtimeIndex = args.indexOf('--candidate-runtime');
const runtimePath = runtimeIndex >= 0 ? args[runtimeIndex + 1] : undefined;
const infrastructureTest = args.includes('--infrastructure-test');
const jsonMode = args.includes('--json');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const optionCounts = (name: string) => args.filter((arg) => arg === name).length;
const consumed = new Set([manifestIndex, manifestIndex + 1, freezeCommitIndex, freezeCommitIndex + 1, generationIndex, generationIndex + 1,
  challengeIndex, challengeIndex + 1, sourceIndex, sourceIndex + 1, runtimeIndex, runtimeIndex + 1]);
const validArgs = manifestPath && manifestIndex >= 0 && optionCounts('--candidate-manifest') === 1 && optionCounts('--json') <= 1 &&
  optionCounts('--infrastructure-test') <= 1 && optionCounts('--freeze-commit') <= 1 && optionCounts('--generation-evidence') <= 1 &&
  optionCounts('--challenge-manifest') <= 1 && optionCounts('--candidate-source') <= 1 && optionCounts('--candidate-runtime') <= 1 &&
  args.every((arg, index) => consumed.has(index) || ['--json', '--infrastructure-test'].includes(arg)) &&
  (infrastructureTest ? !freezeCommitSha && !generationPath && !challengePath && !sourcePath && !runtimePath :
    freezeCommitSha && generationPath && challengePath && sourcePath && runtimePath);
if (!validArgs) {
  process.stderr.write('CAT_SUBJECT_ERROR=CONTROLLED_FREEZE_COMMIT_REQUIRED: controlled runs require --freeze-commit, candidate source/runtime, generation evidence, and challenge manifest; infrastructure-only runs require --infrastructure-test\n');
  process.exitCode = 2;
} else {
  try {
    let controlled: ReturnType<typeof validateControlledBenchmarkSubject> | null = null;
    let manifest: any;
    if (!infrastructureTest) {
      manifest = JSON.parse(readFileSync(path.resolve(root, manifestPath!), 'utf8'));
      controlled = await verifyControlledCandidate({repoRoot: root, freezeCommitSha: freezeCommitSha!,
        sourceRoot: path.resolve(root, sourcePath!), runtimeRoot: path.resolve(root, runtimePath!),
        manifestPath: path.resolve(root, manifestPath!), generationEvidencePath: path.resolve(root, generationPath!),
        challengeManifestPath: path.resolve(root, challengePath!)});
    }
    const receipt = await runP03SubjectEvaluation(manifestPath);
    let controlledReceipt: any = null;
    if (controlled) {
      controlledReceipt = createControlledBenchmarkReceipt(receipt, controlled);
      if (!verifyControlledBenchmarkReceipt(controlledReceipt)) throw new Error('CONTROLLED_RECEIPT_SELF_VERIFICATION_FAILED');
      const receiptPath = path.resolve(root, controlledReceipt.receiptPath);
      mkdirSync(path.dirname(receiptPath), {recursive: true});
      writeFileSync(receiptPath, JSON.stringify(controlledReceipt, null, 2) + '\n', {flag: 'wx'});
    }
    if (jsonMode) process.stdout.write(JSON.stringify(controlledReceipt ?? receipt, null, 2) + '\n');
    else process.stdout.write([
      'CAT_SUBJECT_CASE=' + receipt.caseId,
      'CAT_SUBJECT_ID=' + receipt.subject.candidateId,
      'CAT_SUBJECT_JOB_STATUS=' + receipt.jobStatus,
      'CAT_SUBJECT_DECISION=' + (receipt.decision ?? 'NONE'),
      'CAT_SUBJECT_V2=' + (receipt.subject.attempts[0]?.v2Result ?? 'NOT_RUN'),
      'CAT_SUBJECT_RECEIPT=' + receipt.receiptPath,
      'CAT_SUBJECT_RECEIPT_HASH=' + receipt.receiptHash,
      ...(controlledReceipt ? ['CAT_CONTROLLED_RECEIPT=' + controlledReceipt.receiptPath, 'CAT_CONTROLLED_RECEIPT_HASH=' + controlledReceipt.receiptHash] : []),
    ].join('\n') + '\n');
    if (receipt.jobStatus !== 'COMPLETED') process.exitCode = 1;
  } catch (error) {
    const code = error instanceof Error && /^SUBJECT_[A-Z0-9_]+$/.test(error.message) ? error.message : 'SUBJECT_EVALUATION_FAILED';
    process.stderr.write('CAT_SUBJECT_ERROR=' + code + '\n');
    process.exitCode = 1;
  }
}
