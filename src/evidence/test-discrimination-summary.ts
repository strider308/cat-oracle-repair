import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {evaluateObservation} from '../oracle/evaluate.ts';
import {solveOracleGap} from '../oracle/gap-solver.ts';
import {runOracleRepairDemonstrations} from '../oracle/execute-fixtures.ts';
import {verifyP03ReceiptDetailed} from '../evaluation/p03-runner.ts';

const P03_ROOT = 'evidence/historical/p03-v2';
const RELEASE_BASELINE = '32208efa9ec2a034431629af94bfd15f49870db5';
const SOURCES = [
  {id: 'contract', repoPath: 'fixtures/hero/node-cache-ttl-zero-001/contract.json', packagePath: 'sources/approved-behavior.json', sha256: '7602f5ec77ae7a5aeb024fca04448d70f0125dccc4cad5f43508b6d83535095b'},
  {id: 'oracle-v1', repoPath: 'fixtures/hero/node-cache-ttl-zero-001/oracle-v1.json', packagePath: 'sources/oracle-v1.json', sha256: '4fbf4c5cbcc19b054e916800537c3ac77fdf2c6c3907a56cb5e29873b67b5722'},
  {id: 'oracle-v2', repoPath: 'fixtures/hero/node-cache-ttl-zero-001/oracle-v2.json', packagePath: 'sources/oracle-v2.json', sha256: '72cb331c0d7f8ea85f8ff96625f329764bbcbdd784762e59b22e5c0c35c55231'},
  {id: 'suite-evidence', repoPath: `${P03_ROOT}/suite-evidence.18055ed675c50f2e4e2ae58ff345498dd10656010e485559152fb99e5949f199.json`, packagePath: 'sources/p03-suite-evidence.json', sha256: '18055ed675c50f2e4e2ae58ff345498dd10656010e485559152fb99e5949f199'},
  {id: 'candidate-executions', repoPath: `${P03_ROOT}/candidate-executions.a68061ecb461ad30f44582372adb23df8f272df205b799bad0996938f0fff1a7.json`, packagePath: 'sources/p03-candidate-executions.json', sha256: 'a68061ecb461ad30f44582372adb23df8f272df205b799bad0996938f0fff1a7'},
  {id: 'oracle-attack', repoPath: `${P03_ROOT}/oracle-attack.aca2f79c77c65d716c2d36f6ae8feaa41d281a6685285d8c7ed3237fafdf6df4.json`, packagePath: 'sources/p03-oracle-attack.json', sha256: 'aca2f79c77c65d716c2d36f6ae8feaa41d281a6685285d8c7ed3237fafdf6df4'},
  {id: 'p03-receipt-file', repoPath: `${P03_ROOT}/receipt-v2.1271e7ed0552bc752c714e27ce61b65e79ebbc3446879e05ff158126c54f735b.json`, packagePath: '', sha256: '38b2917939ebe225bbbbf393a8a3469dbed54a9eb70a6d374b4e1ab209cd6038'},
] as const;

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function readPinnedJson(root: string, source: typeof SOURCES[number]): {bytes: Buffer; value: any} {
  const bytes = readFileSync(path.join(root, source.repoPath));
  if (sha256(bytes) !== source.sha256) throw new Error(`DISCRIMINATION_SOURCE_HASH_MISMATCH:${source.id}`);
  return {bytes, value: JSON.parse(bytes.toString('utf8'))};
}

export function loadTestDiscriminationSummary(root = process.cwd()): {
  summary: Record<string, any>;
  sourceFiles: {path: string; bytes: Buffer; sha256: string}[];
} {
  const loaded = Object.fromEntries(SOURCES.map((source) => [source.id, readPinnedJson(root, source)]));
  const suite = loaded['suite-evidence'].value;
  const candidates = loaded['candidate-executions'].value.candidates;
  const attack = loaded['oracle-attack'].value;
  const receipt = loaded['p03-receipt-file'].value;
  const contract = loaded.contract.value;
  const v1 = loaded['oracle-v1'].value;
  const v2 = loaded['oracle-v2'].value;
  const outcomes = Object.fromEntries(Object.entries(candidates).map(([id, candidate]: [string, any]) => [id, {
    v1: evaluateObservation(candidate.v1, v1),
    v2: evaluateObservation(candidate.v2, v2),
  }]));

  if (suite.result !== 'PASS' || suite.testsPassed !== 8 || suite.testsFailed !== 0 ||
      receipt.runId !== 'b2a36325-0979-439e-a67b-2db3dc80d77b' || receipt.receiptHash !== '1271e7ed0552bc752c714e27ce61b65e79ebbc3446879e05ff158126c54f735b' ||
      receipt.candidate?.decision !== 'REJECTED' || receipt.candidate?.gates?.['existing-suite'] !== 'PASS' ||
      candidates.wrong?.candidateSha !== receipt.candidate.candidateSha || attack.survivorCandidateHash !== candidates.survivor?.candidateSha ||
      outcomes.wrong.v1 !== 'FAIL' || outcomes.wrong.v2 !== 'FAIL' || outcomes.good.v1 !== 'PASS' || outcomes.good.v2 !== 'PASS' ||
      outcomes.survivor.v1 !== 'PASS' || outcomes.survivor.v2 !== 'FAIL' || outcomes.equivalent.v1 !== 'PASS' || outcomes.equivalent.v2 !== 'PASS' ||
      attack.survivorV1Result !== outcomes.survivor.v1 || attack.survivorV2Result !== outcomes.survivor.v2 ||
      attack.knownWrongV1Result !== outcomes.wrong.v1 || attack.knownWrongV2Result !== outcomes.wrong.v2 ||
      attack.knownGoodV2Result !== outcomes.good.v2 || attack.equivalentV2Result !== outcomes.equivalent.v2 ||
      attack.finalOracleStatus !== 'CALIBRATED' || attack.oracleV1Hash !== SOURCES.find((source) => source.id === 'oracle-v1')!.sha256 ||
      attack.oracleV2Hash !== SOURCES.find((source) => source.id === 'oracle-v2')!.sha256) {
    throw new Error('DISCRIMINATION_CONTROL_RELATIONSHIP_INVALID');
  }
  const requirement = contract.clauses?.MUST_CHANGE?.find((item: any) => item.id === 'ttl-zero-refreshes-without-expiry');
  if (requirement?.statement !== 'Calling ttl(key, 0) on an existing cache entry must preserve the entry without an expiry.' ||
      v1.observes.includes('expiresAt') || !v2.observes.includes('expiresAt')) throw new Error('DISCRIMINATION_REQUIREMENT_BINDING_INVALID');

  const gapControls = [
    {id: 'known-good', role: 'POSITIVE', currentOutcome: outcomes.good.v1, candidateSha256: candidates.good.candidateSha, suiteObservation: candidates.good.v1, observation: candidates.good.v1},
    {id: 'equivalent', role: 'POSITIVE', currentOutcome: outcomes.equivalent.v1, candidateSha256: candidates.equivalent.candidateSha, suiteObservation: candidates.equivalent.v1, observation: candidates.equivalent.v1},
    {id: 'finite-expiry-survivor', role: 'SURVIVOR', currentOutcome: outcomes.survivor.v1, candidateSha256: candidates.survivor.candidateSha, suiteObservation: candidates.survivor.v1, observation: candidates.survivor.v1},
    {id: 'known-wrong', role: 'ALREADY_REJECTED', currentOutcome: outcomes.wrong.v1, candidateSha256: candidates.wrong.candidateSha, suiteObservation: candidates.wrong.v1, observation: candidates.wrong.v1},
  ] as const;
  const gap = solveOracleGap({
    authority: {status: 'SOURCE_SUPPORTED_CONTRACT', clauseId: requirement.id, contractSha256: SOURCES.find((source) => source.id === 'contract')!.sha256},
    scenarioSha256: SOURCES.find((source) => source.id === 'oracle-v1')!.sha256,
    inputSha256: SOURCES.find((source) => source.id === 'suite-evidence')!.sha256,
    currentOracle: {observes: v1.observes, expected: v1.expected},
    candidateFields: [{field: 'expiresAt', expected: 0, meaning: requirement.observableEvidence}],
    controls: gapControls,
  });
  if (gap.status !== 'PROPOSAL' || JSON.stringify(gap.minimumAdditions) !== JSON.stringify([{fields: ['expiresAt'], expected: {expiresAt: 0}}]) ||
      candidates.good.v2.expiresAt !== 0 || candidates.equivalent.v2.expiresAt !== 0 || candidates.survivor.v2.expiresAt === 0) {
    throw new Error('DISCRIMINATION_GAP_PROPOSAL_CALIBRATION_INVALID');
  }
  const gapAfter = Object.fromEntries(gapControls.map((control) => [control.id, evaluateObservation(control.observation, {
    ...v1,
    observes: [...v1.observes, 'expiresAt'],
    expected: {...v1.expected, expiresAt: 0},
  })]));

  const historicalReceiptStatus = verifyP03ReceiptDetailed(receipt, root);
  const packageSourceSha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  if (!/^[a-f0-9]{40}$/.test(packageSourceSha)) throw new Error('DISCRIMINATION_PACKAGE_SOURCE_INVALID');

  const sourceFiles = SOURCES.filter((source) => source.packagePath).map((source) => ({
    path: source.packagePath,
    bytes: loaded[source.id].bytes as Buffer,
    sha256: source.sha256,
  }));
  const summary = {
    schema: 'CatTestDiscriminationSummaryV3',
    packageSourceSha,
    baselineReleaseSha: RELEASE_BASELINE,
    productQuestion: 'Your tests passed. Would the wrong product have passed too?',
    publicOracleStatus: 'WEAK',
    historicalP03: {
      runId: receipt.runId,
      receiptHash: receipt.receiptHash,
      receiptFileSha256: SOURCES.find((source) => source.id === 'p03-receipt-file')!.sha256,
      baselineCommit: receipt.baseSha,
      knownWrongCandidateSha: receipt.candidate.candidateSha,
      resultScope: 'RECORDED_HISTORICAL_CONTROLS',
      archivedReceiptVerification: historicalReceiptStatus.overall,
      missingArtifactIds: historicalReceiptStatus.missingArtifactIds,
      limitation: 'The archived receipt envelope and retained artifact hashes are checked, but the historical controller-runner artifact is missing; this is not a fresh P03 replay.',
    },
    approvedBehavior: {
      statement: requirement.statement,
      observable: requirement.observableEvidence,
      contractSha256: SOURCES.find((source) => source.id === 'contract')!.sha256,
    },
    oracleVersions: [
      {id: v1.id, sha256: SOURCES.find((source) => source.id === 'oracle-v1')!.sha256, observes: v1.observes, leavesOut: ['expiresAt']},
      {id: v2.id, sha256: SOURCES.find((source) => source.id === 'oracle-v2')!.sha256, observes: v2.observes},
    ],
    oracleGap: {
      ...gap,
      algorithmVersion: 'CAT_ORACLE_GAP_V1',
      analysisScope: 'RECORDED_HISTORICAL_CONTROLS',
      beforeAfter: gapControls.map((control) => ({id: control.id, before: control.currentOutcome, after: gapAfter[control.id]})),
      calibrationAgainstHistoricalV2: Object.fromEntries(Object.entries(outcomes).map(([id, value]: [string, any]) => [id, {v2: value.v2, proposed: gapAfter[id] ?? value.v1}])),
      publicStatusEffect: 'NONE_PUBLIC_ORACLE_REMAINS_WEAK',
    },
    controls: [
      {id: 'known-wrong', label: 'Known wrong', candidateSha: candidates.wrong.candidateSha, existingSuite: 'PASS', existingSuiteTests: 8, ...outcomes.wrong, outcomeSource: 'RECORDED'},
      {id: 'known-good', label: 'Known good', candidateSha: candidates.good.candidateSha, existingSuite: 'NOT_RECORDED', ...outcomes.good, outcomeSource: 'RECORDED'},
      {id: 'finite-expiry-survivor', label: 'V1 survivor', candidateSha: candidates.survivor.candidateSha, existingSuite: 'NOT_RECORDED', ...outcomes.survivor, observedExpiresAt: candidates.survivor.v1.expiresAt, expectedExpiresAt: 0, violatedClauseId: attack.violatedClauseIds[0], outcomeSource: 'RECORDED'},
      {id: 'equivalent', label: 'Equivalent control', candidateSha: candidates.equivalent.candidateSha, existingSuite: 'NOT_RECORDED', ...outcomes.equivalent, outcomeSource: 'RECORDED'},
    ],
    historicalCalibration: attack.finalOracleStatus,
    executableOracleRepairs: runOracleRepairDemonstrations(root).map((receipt) => ({...receipt,
      receiptFile: `executions/${receipt.caseId}-${receipt.runId}.json`})),
    sourceBindings: sourceFiles.map(({path, sha256}) => ({path, sha256})),
    evidenceScope: 'Artifact hashes and cross-record identities are checked at package build. Historical outcomes remain recorded evidence; public oracle status stays WEAK.',
  };
  return {summary, sourceFiles};
}

export function serializeTestDiscriminationSummary(root = process.cwd()): string {
  return `${JSON.stringify(loadTestDiscriminationSummary(root).summary, null, 2)}\n`;
}
