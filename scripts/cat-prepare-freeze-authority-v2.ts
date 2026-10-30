import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FREEZE_V2_PATHS, FREEZE_V2_PREPARATION_PATHS, prepareFreezeAuthorityV2} from '../src/benchmark/freeze-authority-v2.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
if (baseIndex < 0 || !/^[a-f0-9]{40}$/.test(args[baseIndex + 1] ?? '')) throw new Error('USAGE: cat-prepare-freeze-authority-v2.ts --base <full-commit-sha>');
if (args.length !== 2) throw new Error('USAGE: cat-prepare-freeze-authority-v2.ts --base <full-commit-sha>');

const result = prepareFreezeAuthorityV2(repoRoot, args[baseIndex + 1], FREEZE_V2_PREPARATION_PATHS);
process.stdout.write(JSON.stringify({
  futureTreeSha: result.futureTreeSha,
  exactCommitPaths: result.exactCommitPaths,
  preCandidateFreezeSha256: result.preCandidateFreezeSha256,
  manifestVersion: result.manifest.manifestVersion,
  closureRows: result.closure.rows.length,
  closureRowsSha256: result.manifest.executableClosureSha256,
  realIndexChanged: result.realIndexChanged,
  controlledPathInventory: [FREEZE_V2_PATHS.profile, FREEZE_V2_PATHS.mutationSpec, FREEZE_V2_PATHS.buildContract, FREEZE_V2_PATHS.sameCandidateProtocol],
}, null, 2) + '\n');
