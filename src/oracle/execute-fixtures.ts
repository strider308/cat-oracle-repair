import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical} from './canonical.ts';
import {solveOracleGap} from './gap-solver.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHILD = 'scripts/oracle-gap-fixture-child.mjs';
const CHILD_LIMIT = 64 * 1024;
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const ROLES = {good: 'POSITIVE', equivalent: 'POSITIVE', survivor: 'SURVIVOR', rejected: 'ALREADY_REJECTED'} as const;
const CANDIDATES = {
  'h0-2-export': {good: 'fixtures/oracle-gap-repair/auth-good.mjs', equivalent: 'fixtures/oracle-gap-repair/auth-equivalent.mjs', survivor: 'fixtures/oracle-gap-repair/auth-survivor.mjs', rejected: 'fixtures/oracle-gap-repair/auth-rejected.mjs'},
  idempotency: {good: 'fixtures/oracle-gap-repair/idempotency-good.mjs', equivalent: 'fixtures/oracle-gap-repair/idempotency-equivalent.mjs', survivor: 'fixtures/oracle-gap-repair/idempotency-survivor.mjs', rejected: 'fixtures/oracle-gap-repair/idempotency-rejected.mjs'},
} as const;
export const H0_2_OBSERVATION_SCENARIOS = [
  {id: 'cross-tenant-authorized', description: 'Export a record from another tenant while the user has export permission.', input: {subject: {tenant: 'north', canExport: true}, record: {tenant: 'south'}}},
  {id: 'cross-tenant-unauthorized', description: 'Export a record from another tenant while the user lacks export permission.', input: {subject: {tenant: 'north', canExport: false}, record: {tenant: 'south'}}},
  {id: 'same-tenant-authorized', description: 'Export a record from the active tenant while the user has export permission.', input: {subject: {tenant: 'north', canExport: true}, record: {tenant: 'north'}}},
  {id: 'same-tenant-unauthorized', description: 'Export a record from the active tenant while the user lacks export permission.', input: {subject: {tenant: 'north', canExport: false}, record: {tenant: 'north'}}},
] as const;
export const H0_2_ORDINARY_SUITE = [
  {subject: {tenant: 'north', canExport: true}, record: {tenant: 'north'}, expected: 'ALLOW'},
  {subject: {tenant: 'north', canExport: false}, record: {tenant: 'north'}, expected: 'DENY'},
] as const;
const SOURCE_BINDING_FILES = [
  'src/oracle/canonical.ts', 'src/oracle/gap-solver.ts', 'src/oracle/execute-fixtures.ts', CHILD,
  'scripts/cat-oracle-gap-repair.ts', 'package.json',
  'docs/HUMAN_APPROVED_CONTRACTS.md', 'fixtures/oracle-gap-repair/idempotency-contract.json',
  ...Object.values(CANDIDATES).flatMap((items) => Object.values(items)),
].sort();

function definitions(root: string) {
  const contractsPath = 'docs/HUMAN_APPROVED_CONTRACTS.md';
  const contracts = readFileSync(path.join(root, contractsPath));
  const contractsText = contracts.toString('utf8');
  const h02 = 'A user may export only records belonging to the tenant they are currently accessing and for which they are authorized. Visibility, ownership by the same user, organization membership, sharing status, or elevated tenant-level role must not allow records from another tenant to appear in the export unless an explicit cross-tenant permission exists.';
  if (!contractsText.includes('## H0-2 — Tenant-scoped export') || !contractsText.includes(h02)) throw new Error('H0_2_AUTHORITY_SOURCE_MISMATCH');
  const syntheticPath = 'fixtures/oracle-gap-repair/idempotency-contract.json';
  const synthetic = JSON.parse(readFileSync(path.join(root, syntheticPath), 'utf8'));
  if (synthetic.status !== 'SYNTHETIC_DRAFT' || synthetic.contractId !== 'synthetic-idempotency-once-v1') throw new Error('SYNTHETIC_CONTRACT_STATUS_INVALID');
  return [
    {
      id: 'h0-2-export', clauseId: 'H0-2', contractStatus: 'HUMAN_APPROVED_SOURCE', contractSha256: sha(contracts), contractPath: contractsPath,
      scenario: {id: 'same-cross-tenant-export-v1', operation: 'export a record outside the active tenant'},
      input: {subject: {tenant: 'north', canExport: true}, record: {tenant: 'south'}},
      suite: H0_2_ORDINARY_SUITE,
      candidateFields: [{field: 'response', expected: 'DENY', meaning: 'A cross-tenant export is denied.'}],
    },
    {
      id: 'idempotency', clauseId: synthetic.contractId, contractStatus: synthetic.status, contractSha256: sha(readFileSync(path.join(root, syntheticPath))), contractPath: syntheticPath,
      scenario: {id: 'duplicate-operation-replay-v1', operation: 'apply the same valid operation ID twice'},
      input: {initialState: {balance: 0, seen: []}, operations: [{id: 'op-1', amount: 5}, {id: 'op-1', amount: 5}]},
      suite: [
        {initialState: {balance: 0, seen: []}, operations: [{id: 'op-1', amount: 5}], expected: {response: 'OK', balance: 5}},
        {initialState: {balance: 0, seen: []}, operations: [{id: 'op-invalid', amount: 0}], expected: {response: 'INVALID', balance: 0}},
      ],
      candidateFields: [{field: 'balance', expected: 5, meaning: 'Balance after two applications of the same operation ID.'}],
    },
  ];
}

function invoke(root: string, payload: Buffer, candidateId: string, attemptId: string): {result: any; attempt: Record<string, unknown>} {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'cat-oracle-child-'));
  let attempt: Record<string, unknown> | undefined;
  try {
    const childEnv: NodeJS.ProcessEnv = {TEMP: temporary, TMP: temporary, TMPDIR: temporary};
    if (process.env.SystemRoot) childEnv.SystemRoot = process.env.SystemRoot;
    const run = spawnSync(process.execPath, ['--disable-proto=throw', path.join(root, CHILD), candidateId], {
      cwd: temporary,
      env: childEnv,
      input: payload,
      encoding: 'buffer',
      timeout: 5_000,
      maxBuffer: CHILD_LIMIT,
      windowsHide: true,
      shell: false,
    });
    const stdout = run.stdout ?? Buffer.alloc(0);
    const stderr = run.stderr ?? Buffer.alloc(0);
    attempt = {
      attemptId,
      command: ['node', '--disable-proto=throw', CHILD, candidateId],
      environment: {node: process.version, platform: process.platform, architecture: process.arch, credentialEnvironmentPassed: false, cwd: 'temporary-empty-directory'},
      stdinSha256: sha(payload),
      cleanupVerified: false,
      exitCode: run.status,
      signal: run.signal,
      timedOut: run.error?.code === 'ETIMEDOUT',
      spawnError: run.error?.code ?? null,
      stdoutSha256: sha(stdout),
      stderrSha256: sha(stderr),
      stdout: stdout.toString('utf8'),
      stderr: stderr.toString('utf8'),
    };
    if (run.error || run.status !== 0 || stderr.length || stdout.length > CHILD_LIMIT) return {result: null, attempt};
    try {
      const result = JSON.parse(stdout.toString('utf8'));
      if (stdout.toString('utf8') !== `${JSON.stringify(result)}\n`) return {result: null, attempt};
      return {result, attempt};
    } catch { return {result: null, attempt}; }
  } finally {
    rmSync(temporary, {recursive: true, force: true});
    if (attempt) attempt.cleanupVerified = !existsSync(temporary);
  }
}

function equal(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function makeDemonstration(root: string, definition: ReturnType<typeof definitions>[number], outputRoot: string) {
  const domain = definition.id as keyof typeof CANDIDATES;
  const scenarioBytes = Buffer.from(canonical({domain, scenario: definition.scenario, contractSha256: definition.contractSha256}));
  const inputBytes = Buffer.from(canonical(definition.input));
  const payload = Buffer.from(canonical({domain, scenario: definition.input, suite: definition.suite}));
  const runnerSha = sha(readFileSync(path.join(root, CHILD)));
  const sourceFiles = SOURCE_BINDING_FILES.map((file) => ({path: file, sha256: sha(readFileSync(path.join(root, file)))}));
  const trackedWorkingTreeChanges = Boolean(execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=no'], {encoding: 'utf8'}).trim());
  const executions = (Object.keys(CANDIDATES[domain]) as (keyof typeof ROLES)[]).map((id) => {
    const candidatePath = CANDIDATES[domain][id];
    const candidateSha256 = sha(readFileSync(path.join(root, candidatePath)));
    const first = invoke(root, payload, id, `${domain}:${id}:1`);
    const second = invoke(root, payload, id, `${domain}:${id}:2`);
    const deterministic = first.result !== null && second.result !== null && equal(first.result, second.result);
    const suitePass = deterministic && first.result.suiteResults.every((result: any) => result.pass === true);
    return {id, role: ROLES[id], candidatePath, candidateSha256, suiteOutcome: suitePass ? 'PASS' : 'FAIL',
      ordinarySuiteResultSha256: deterministic ? sha(canonical(first.result.suiteResults)) : null,
      observation: deterministic ? first.result.observation : null,
      observationSha256: deterministic ? sha(canonical(first.result.observation)) : null,
      deterministic, attempts: [first.attempt, second.attempt]};
  });
  const executionFailure = executions.some((execution) => !execution.deterministic || execution.observation === null);
  const solverInput = {
    authority: {status: 'SOURCE_SUPPORTED_CONTRACT' as const, clauseId: definition.clauseId, contractSha256: definition.contractSha256},
    scenarioSha256: sha(scenarioBytes), inputSha256: sha(inputBytes),
    currentOracle: {observes: ['suiteAccepted'], expected: {suiteAccepted: true}},
    candidateFields: definition.candidateFields,
    controls: executions.map((execution) => ({id: execution.id, role: execution.role, currentOutcome: execution.suiteOutcome, candidateSha256: execution.candidateSha256,
      suiteObservation: {suiteAccepted: execution.suiteOutcome === 'PASS'}, observation: execution.observation ?? {}})),
  };
  const gap = executionFailure ? {status: 'UNRESOLVED', reason: 'A child process failed, timed out, emitted malformed output, or was nondeterministic.'} : solveOracleGap(solverInput);
  const minimum = (gap as any).minimumAdditions?.[0];
  const assertion = minimum ? {fields: minimum.fields, expected: minimum.expected} : null;
  const controls = executions.map((execution) => {
    const proposed = assertion && execution.observation && assertion.fields.every((field: string) => Object.hasOwn(execution.observation, field) && equal(execution.observation[field], assertion.expected[field]));
    return {id: execution.id, role: execution.role, originalSuiteOutcome: execution.suiteOutcome,
      proposedAssertionOutcome: proposed ? 'PASS' : proposed === false ? 'FAIL' : 'UNRESOLVED',
      combinedFinalAcceptance: execution.suiteOutcome === 'PASS' && proposed ? 'ACCEPT' : execution.suiteOutcome === 'FAIL' || proposed === false ? 'REJECT' : 'UNRESOLVED',
      candidatePath: execution.candidatePath, candidateSha256: execution.candidateSha256, observation: execution.observation,
    };
  });
  const expected = controls.every((control) => control.role === 'POSITIVE' ? control.combinedFinalAcceptance === 'ACCEPT' : control.combinedFinalAcceptance === 'REJECT');
  const sourceStable = sourceFiles.every((file) => sha(readFileSync(path.join(root, file.path))) === file.sha256);
  const verified = gap.status === 'PROPOSAL' && assertion !== null && !executionFailure && expected && sourceStable && new Set(controls.map((control) => control.candidateSha256)).size === controls.length;
  const body: Record<string, unknown> = {
    schema: 'CatExecutableOracleRepairReceiptV1', caseId: definition.id, specificationStatus: definition.contractStatus, contractPath: definition.contractPath,
    contractSha256: definition.contractSha256, clauseId: definition.clauseId, sourceCommit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
    trackedWorkingTreeChanges, sourceFiles, sourceTreeSha256: sha(canonical(sourceFiles)),
    executionMode: 'CONTROLLED_NODE_CHILD_PROCESS', securityBoundary: 'PROCESS_SEPARATION_ONLY_NOT_DOCKER_SECURITY_ISOLATION',
    runnerPath: CHILD, runnerSha256: runnerSha, scenario: definition.scenario, scenarioBytesSha256: sha(scenarioBytes), input: definition.input, inputBytesSha256: sha(inputBytes),
    sharedChildInputBytesSha256: sha(payload), ordinarySuite: definition.suite, ordinarySuiteSha256: sha(canonical(definition.suite)),
    candidateFields: definition.candidateFields, proposedAssertion: assertion, proposedAssertionSha256: assertion ? sha(canonical(assertion)) : null, solverStatus: gap.status, solverResult: gap,
    controls, executions, verificationStatus: verified ? 'EXECUTED_VERIFIED_CASE_SCOPE' : 'UNRESOLVED', publicOracleEffect: 'NONE_PUBLIC_STATUS_REMAINS_WEAK',
  };
  const runId = sha(canonical(body));
  const receipt = {...body, runId, receiptSha256: sha(canonical({...body, runId}))};
  const outputDir = path.join(outputRoot, definition.id);
  mkdirSync(outputDir, {recursive: true});
  const receiptPath = path.join(outputDir, `${runId}.json`);
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
  if (existsSync(receiptPath)) {
    if (readFileSync(receiptPath, 'utf8') !== receiptBytes) throw new Error('ORACLE_EXECUTION_RECEIPT_COLLISION');
  } else writeFileSync(receiptPath, receiptBytes, {flag: 'wx'});
  return receipt;
}

export function verifyOracleRepairReceipt(receipt: Record<string, any>, root = ROOT): boolean {
  try {
    if (receipt.schema !== 'CatExecutableOracleRepairReceiptV1' || receipt.executionMode !== 'CONTROLLED_NODE_CHILD_PROCESS' || receipt.securityBoundary !== 'PROCESS_SEPARATION_ONLY_NOT_DOCKER_SECURITY_ISOLATION') return false;
    const definitionsForCase = definitions(root).find((item) => item.id === receipt.caseId);
    if (!definitionsForCase || receipt.contractPath !== definitionsForCase.contractPath || receipt.contractSha256 !== definitionsForCase.contractSha256 || receipt.specificationStatus !== definitionsForCase.contractStatus) return false;
    if (!equal(receipt.scenario, definitionsForCase.scenario) || !equal(receipt.input, definitionsForCase.input) || !equal(receipt.ordinarySuite, definitionsForCase.suite) || !equal(receipt.candidateFields, definitionsForCase.candidateFields)) return false;
    if (receipt.ordinarySuiteSha256 !== sha(canonical(definitionsForCase.suite))) return false;
    if (receipt.sourceCommit !== execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim()) return false;
    if (receipt.trackedWorkingTreeChanges !== Boolean(execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=no'], {encoding: 'utf8'}).trim())) return false;
    const sourceFiles = SOURCE_BINDING_FILES.map((file) => ({path: file, sha256: sha(readFileSync(path.join(root, file)))}));
    if (!equal(receipt.sourceFiles, sourceFiles) || receipt.sourceTreeSha256 !== sha(canonical(sourceFiles))) return false;
    if (receipt.runnerPath !== CHILD || sha(readFileSync(path.join(root, CHILD))) !== receipt.runnerSha256) return false;
    if (sha(Buffer.from(canonical({domain: receipt.caseId, scenario: receipt.scenario, contractSha256: receipt.contractSha256}))) !== receipt.scenarioBytesSha256) return false;
    if (sha(Buffer.from(canonical(receipt.input))) !== receipt.inputBytesSha256 || sha(Buffer.from(canonical({domain: receipt.caseId, scenario: receipt.input, suite: receipt.ordinarySuite}))) !== receipt.sharedChildInputBytesSha256) return false;
    if (!Array.isArray(receipt.executions) || receipt.executions.length !== 4 || !Array.isArray(receipt.controls) || receipt.controls.length !== 4) return false;
    for (const execution of receipt.executions) {
      if (CANDIDATES[receipt.caseId as keyof typeof CANDIDATES]?.[execution.id as keyof typeof ROLES] !== execution.candidatePath) return false;
      if (sha(readFileSync(path.join(root, execution.candidatePath))) !== execution.candidateSha256 || !execution.deterministic || execution.attempts.length !== 2) return false;
      if (execution.attempts.some((attempt: any, index: number) => attempt.attemptId !== `${receipt.caseId}:${execution.id}:${index + 1}` || attempt.environment?.credentialEnvironmentPassed !== false || attempt.command?.join(' ') !== `node --disable-proto=throw ${CHILD} ${execution.id}`)) return false;
      if (execution.attempts.some((attempt: any) => attempt.exitCode !== 0 || attempt.timedOut || attempt.spawnError || !attempt.cleanupVerified || attempt.stderr !== '' || attempt.stdinSha256 !== receipt.sharedChildInputBytesSha256 || sha(Buffer.from(attempt.stdout)) !== attempt.stdoutSha256)) return false;
      const first = JSON.parse(execution.attempts[0].stdout);
      const second = JSON.parse(execution.attempts[1].stdout);
      if (!equal(first, second) || !equal(first.observation, execution.observation) || execution.observationSha256 !== sha(canonical(execution.observation)) ||
          execution.ordinarySuiteResultSha256 !== sha(canonical(first.suiteResults)) || execution.suiteOutcome !== (first.suiteResults.every((result: any) => result.pass === true) ? 'PASS' : 'FAIL')) return false;
    }
    for (const control of receipt.controls) {
      const execution = receipt.executions.find((item: any) => item.id === control.id);
      if (!execution || control.candidatePath !== execution.candidatePath || control.candidateSha256 !== execution.candidateSha256 || control.originalSuiteOutcome !== execution.suiteOutcome) return false;
      const assertionPass = receipt.proposedAssertion.fields.every((field: string) => Object.hasOwn(control.observation, field) && equal(control.observation[field], receipt.proposedAssertion.expected[field]));
      if (control.proposedAssertionOutcome !== (assertionPass ? 'PASS' : 'FAIL') || control.combinedFinalAcceptance !== (control.originalSuiteOutcome === 'PASS' && assertionPass ? 'ACCEPT' : 'REJECT')) return false;
    }
    const gap = solveOracleGap({
      authority: {status: 'SOURCE_SUPPORTED_CONTRACT', clauseId: receipt.clauseId, contractSha256: receipt.contractSha256},
      scenarioSha256: receipt.scenarioBytesSha256,
      inputSha256: receipt.inputBytesSha256,
      currentOracle: {observes: ['suiteAccepted'], expected: {suiteAccepted: true}},
      candidateFields: receipt.candidateFields,
      controls: receipt.executions.map((execution: any) => ({id: execution.id, role: execution.role, currentOutcome: execution.suiteOutcome,
        candidateSha256: execution.candidateSha256, suiteObservation: {suiteAccepted: execution.suiteOutcome === 'PASS'}, observation: execution.observation})),
    });
    if (!equal(gap, receipt.solverResult) || !equal(receipt.proposedAssertion, gap.minimumAdditions?.[0] ? {fields: gap.minimumAdditions[0].fields, expected: gap.minimumAdditions[0].expected} : null)) return false;
    if (receipt.proposedAssertionSha256 !== (receipt.proposedAssertion ? sha(canonical(receipt.proposedAssertion)) : null)) return false;
    const {runId, receiptSha256, ...body} = receipt;
    const expectedRunId = sha(canonical(body));
    return runId === expectedRunId && receiptSha256 === sha(canonical({...body, runId})) && receipt.verificationStatus === 'EXECUTED_VERIFIED_CASE_SCOPE' && receipt.solverStatus === 'PROPOSAL';
  } catch { return false; }
}

export function runOracleObservationScenario(receipt: Record<string, any>, scenarioId: string, root = ROOT) {
  if (!verifyOracleRepairReceipt(receipt, root) || receipt.caseId !== 'h0-2-export') throw new Error('ORACLE_OBSERVATION_SOURCE_BINDING_INVALID');
  const option = H0_2_OBSERVATION_SCENARIOS.find((item) => item.id === scenarioId);
  if (!option) throw new Error('ORACLE_OBSERVATION_SCENARIO_UNSUPPORTED');
  const payload = Buffer.from(canonical({domain: 'h0-2-export', scenario: option.input, suite: receipt.ordinarySuite}));
  const runs = (Object.keys(CANDIDATES['h0-2-export']) as (keyof typeof ROLES)[]).map((id) => {
    const first = invoke(root, payload, id, `observation:${scenarioId}:${id}:1`);
    const second = invoke(root, payload, id, `observation:${scenarioId}:${id}:2`);
    if (!first.result || !second.result || !equal(first.result, second.result)) throw new Error('ORACLE_OBSERVATION_EXECUTION_UNRESOLVED');
    const ordinarySuiteOutcome = first.result.suiteResults.every((result: any) => result.pass === true) ? 'PASS' : 'FAIL';
    return {id, role: ROLES[id], candidateSha256: sha(readFileSync(path.join(root, CANDIDATES['h0-2-export'][id]))),
      ordinarySuiteOutcome, observation: first.result.observation, observationSha256: sha(canonical(first.result.observation)),
      deterministic: true, attempts: [first.attempt, second.attempt]};
  });
  return {scenarioId, scenario: option.input, controls: runs, sourceTreeSha256: receipt.sourceTreeSha256,
    limitation: 'Process-controlled self-owned fixture execution; not Docker-sealed or general correctness evidence.'};
}

export function runOracleRepairDemonstrations(root = ROOT): Record<string, any>[] {
  const outputRoot = path.join(root, '.verification-runs', 'oracle-repair-executions');
  return definitions(root).map((definition) => {
    const receipt = makeDemonstration(root, definition, outputRoot);
    if (!verifyOracleRepairReceipt(receipt, root)) throw new Error(`ORACLE_EXECUTION_RECEIPT_INVALID:${definition.id}`);
    return receipt;
  });
}
