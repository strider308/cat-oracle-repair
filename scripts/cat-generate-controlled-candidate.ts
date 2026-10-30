import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateControlledCandidate} from '../src/benchmark/controlled-candidate-generator.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name: string) => {
  const indexes = args.map((arg, index) => arg === name ? index : -1).filter((index) => index >= 0);
  if (indexes.length !== 1 || !args[indexes[0] + 1]) throw new Error('GENERATOR_ARGUMENT_INVALID');
  return args[indexes[0] + 1];
};

try {
  if (args.length !== 4 || !args.includes('--freeze-commit') || !args.includes('--output-dir')) throw new Error('GENERATOR_ARGUMENT_INVALID');
  const result = await generateControlledCandidate({repoRoot: root, freezeCommitSha: value('--freeze-commit'), outputDirectory: value('--output-dir')});
  process.stdout.write(`SOURCE_CANDIDATE_HASH=${result.sourceCandidateHash}\nRUNTIME_CANDIDATE_HASH=${result.runtimeCandidateHash}\nGENERATION_EVIDENCE_SHA256=${result.generationEvidenceSha256}\n`);
} catch (error) {
  process.stderr.write(`CAT_GENERATE_ERROR=${error instanceof Error ? error.message : 'GENERATOR_FAILED'}\n`);
  process.exitCode = 1;
}
