import {createHash} from 'node:crypto';
import {existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonical} from '../oracle/canonical.ts';
import {evaluateObservation} from '../oracle/evaluate.ts';
import {REPAIR_DOCKER_IMAGE} from './execution.ts';
import {REPAIR_MODIFIABLE_PATH, validateRepairProposal, verifyRepairRequestContext} from './model-response.ts';
import {normalizeProjectionPath} from './repair-projection.ts';
import {assertP05ImplementationBinding, gitImplementationSource, P05_IMPLEMENTATION_FILES, type ImplementationBinding, type ImplementationSource} from './implementation-binding.ts';
import {deriveBlindSemanticResult, deriveP05Outcome, type BlindOutcome, type RepairBackend, type RepairDecision} from './milestone.ts';
import {resolveTokenFactoryBaseUrl} from '../runtime/nebius.ts';

const HASH = /^[a-f0-9]{64}$/;
const OBJECT_ID = /^[a-f0-9]{40,64}$/;
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export type EvidenceObject = {id: string; sha256: string; bytes: number; role: string; confidentiality: 'PUBLIC' | 'PRIVATE'};
const DECISIONS = new Set(['ACCEPTED', 'REJECTED', 'HUMAN_REQUIRED', null]);
const BINDING_KEYS = ['implementationSha', 'implementationTreeSha', 'implementationFiles'] as const;
const PUBLIC_FIELDS = new Set([...BINDING_KEYS, 'runId', 'candidateHash', 'candidateResult', 'experimentIntegrity', 'milestone', 'jobStatus', 'decision',
  'reasonCodes', 'status', 'executionBackend', 'sandboxStatus', 'sandboxOperationId', 'sandboxEvidenceSha256', 'model', 'requestPackageSha256',
  'responseSha256', 'validatedResponseSha256', 'patchSha256', 'candidateFrozenAt', 'frozenCandidateHash', 'holdoutCreatedAt', 'holdoutSeal',
  'blindResult', 'publicOutcomes', 'publicObjects', 'privateReceipt', 'operationalFailure', 'candidateAvailable', 'seedCreatedAt', 'version',
  'holdoutChallengeCount', 'candidateAccepted', 'provider', 'baseEndpoint', 'requestEndpoint', 'requestId', 'operationId', 'returnedModel',
  'finishReason', 'usage', 'networkAttempts', 'recoveredNetworkCause', 'modelRequestPackageSha256']);
const PRIVATE_FIELDS = new Set([...BINDING_KEYS, 'runId', 'candidateHash', 'candidateResult', 'experimentIntegrity', 'milestone', 'jobStatus', 'decision',
  'reasonCodes', 'state', 'stage', 'operationalFailure', 'objects', 'provider', 'candidateAccepted', 'patchApplication', 'modelResponseObjectId', 'modelResponseContentObjectId', 'modelRequestObjectId',
  'requestPackageSha256', 'responseSha256', 'validatedResponseSha256', 'publicEvidence', 'publicGateEvidenceSha256', 'frozenCandidateManifestSha256',
  'candidateFrozenAt', 'frozenCandidateHash', 'seedCreatedAt', 'holdoutCreatedAt', 'holdoutSeal', 'blindResult', 'holdoutObjectId', 'executionBackend',
  'sandboxStatus', 'sandboxOperationId', 'sandboxEvidenceSha256', 'sandboxBlockerReason', 'dockerEvidenceSha256', 'dependencyTreeSha256', 'version',
  'holdoutChallengeCount', 'lifecycleEventsSha256', 'modelRequestPackageSha256']);

function assertAllowedFields(value: Record<string, unknown>, fields: Set<string>) {
  if (Object.keys(value).some((key) => !fields.has(key))) throw new Error('RECEIPT_FIELD_NOT_ALLOWED');
}

function bindingFields(value: Record<string, any>): ImplementationBinding {
  const binding = Object.fromEntries(BINDING_KEYS.map((key) => [key, value[key]])) as ImplementationBinding;
  if (!OBJECT_ID.test(binding.implementationSha) || !OBJECT_ID.test(binding.implementationTreeSha) ||
      !Array.isArray(binding.implementationFiles) || binding.implementationFiles.length !== P05_IMPLEMENTATION_FILES.length ||
      binding.implementationFiles.some((row, index) => row.path !== P05_IMPLEMENTATION_FILES[index] || !HASH.test(row.sha256))) {
    throw new Error('IMPLEMENTATION_BINDING_INVALID');
  }
  return binding;
}

function validateObjectRefs(objects: unknown, confidentiality: 'PUBLIC' | 'PRIVATE') {
  if (!Array.isArray(objects) || !objects.length) throw new Error('RECEIPT_EVIDENCE_MISSING');
  for (const item of objects) {
    if (!item || typeof item !== 'object' || item.confidentiality !== confidentiality || !HASH.test(item.sha256) ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-z][a-z0-9-]{0,63}$/.test(item.role) ||
        item.id !== `${confidentiality.toLowerCase()}/objects/${item.sha256}.bin`) throw new Error('RECEIPT_EVIDENCE_REFERENCE_INVALID');
  }
}

function ensureDirectory(root: string, target: string) {
  const rel = path.relative(root, target);
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) throw new Error('EVIDENCE_PATH_ESCAPE');
  let current = root;
  if (!existsSync(current)) mkdirSync(current, {mode: 0o700});
  if (lstatSync(current).isSymbolicLink() || !lstatSync(current).isDirectory()) throw new Error('EVIDENCE_ROOT_INVALID');
  for (const segment of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, {mode: 0o700});
    const info = lstatSync(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('EVIDENCE_DIRECTORY_INVALID');
  }
}

export function createV5EvidenceStore(repositoryRoot: string, runId: string) {
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('EVIDENCE_RUN_ID_INVALID');
  const root = path.resolve(repositoryRoot, '.agent-runs', 'p05-s', runId);
  const repo = path.resolve(repositoryRoot);
  if (!root.startsWith(repo + path.sep)) throw new Error('EVIDENCE_PATH_ESCAPE');
  const write = (confidentiality: 'PUBLIC' | 'PRIVATE', role: string, bytes: Buffer | string): EvidenceObject => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(role)) throw new Error('EVIDENCE_ROLE_INVALID');
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8');
    const digest = sha256(data);
    const directory = path.join(root, confidentiality.toLowerCase(), 'objects');
    ensureDirectory(repo, directory);
    const file = path.join(directory, digest + '.bin');
    if (existsSync(file)) {
      if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile() || sha256(readFileSync(file)) !== digest) throw new Error('EVIDENCE_OBJECT_COLLISION');
    } else {
      const temporary = path.join(directory, '.' + randomUUID() + '.tmp');
      try {
        writeFileSync(temporary, data, {flag: 'wx', mode: confidentiality === 'PRIVATE' ? 0o600 : 0o444});
        try { linkSync(temporary, file); }
        catch (error) {
          try { writeFileSync(file, data, {flag: 'wx', mode: confidentiality === 'PRIVATE' ? 0o600 : 0o444}); }
          catch (writeError) {
            if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST' || !existsSync(file) || lstatSync(file).isSymbolicLink() || sha256(readFileSync(file)) !== digest) throw error;
          }
        }
      } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    }
    return {id: path.relative(root, file).split(path.sep).join('/'), sha256: digest, bytes: data.length, role, confidentiality};
  };
  return {
    root,
    writePublic: (role: string, bytes: Buffer | string) => write('PUBLIC', role, bytes),
    writePrivate: (role: string, bytes: Buffer | string) => write('PRIVATE', role, bytes),
    createPrivateReceipt(input: Record<string, unknown> & ImplementationBinding & {runId: string; candidateHash: string; decision: RepairDecision; objects: EvidenceObject[]}) {
      assertAllowedFields(input, PRIVATE_FIELDS);
      bindingFields(input);
      if (input.runId !== runId || !HASH.test(input.candidateHash) || !DECISIONS.has(input.decision)) throw new Error('PRIVATE_RECEIPT_BINDING_INVALID');
      validateObjectRefs(input.objects, 'PRIVATE');
      const bytes = canonical({...input, version: 5});
      const object = write('PRIVATE', 'private-receipt', bytes);
      return {bytes, object};
    },
    createPublicReceipt(input: Record<string, unknown> & ImplementationBinding & {runId: string; candidateHash: string; decision: RepairDecision; publicObjects: EvidenceObject[]}, privateReceipt: EvidenceObject) {
      assertAllowedFields(input, PUBLIC_FIELDS);
      bindingFields(input);
      validateObjectRefs(input.publicObjects, 'PUBLIC');
      if (input.runId !== runId || !HASH.test(input.candidateHash) || !DECISIONS.has(input.decision) ||
          privateReceipt.confidentiality !== 'PRIVATE' || privateReceipt.role !== 'private-receipt') throw new Error('PUBLIC_RECEIPT_BINDING_INVALID');
      const bytes = canonical({...input, version: 5, privateReceipt});
      const object = write('PUBLIC', 'public-receipt', bytes);
      return {bytes, object};
    },
  };
}

function readObject(root: string, ref: EvidenceObject | {id: string; sha256: string}, confidentiality: 'public' | 'private') {
  if (!ref || !HASH.test(ref.sha256) || ref.id !== `${confidentiality}/objects/${ref.sha256}.bin`) throw new Error('RECEIPT_OBJECT_REFERENCE_INVALID');
  const file = path.resolve(root, ...ref.id.split('/'));
  if (!file.startsWith(path.resolve(root) + path.sep) || !existsSync(file)) throw new Error('RECEIPT_OBJECT_MISSING');
  const realRoot = realpathSync(root);
  const realFile = realpathSync(file);
  if (!realFile.startsWith(realRoot + path.sep) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw new Error('RECEIPT_OBJECT_PATH_INVALID');
  const bytes = readFileSync(file);
  if (sha256(bytes) !== ref.sha256 || (ref.bytes !== undefined && bytes.length !== ref.bytes)) throw new Error('RECEIPT_OBJECT_HASH_MISMATCH');
  return bytes;
}

function parseJson(bytes: Buffer, code: string): any {
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Error(code); }
}

function parseObject(root: string, objects: EvidenceObject[], role: string, required = true): any {
  const refs = objects.filter((item) => item.role === role);
  if (!refs.length && !required) return undefined;
  if (refs.length !== 1) throw new Error('RECEIPT_REQUIRED_EVIDENCE_INVALID');
  return parseJson(readObject(root, refs[0], refs[0].confidentiality.toLowerCase() as 'public' | 'private'), 'RECEIPT_EVIDENCE_JSON_INVALID');
}

function assertBindingMatches(value: Record<string, any>, expected: ImplementationBinding) {
  if (canonical(bindingFields(value)) !== canonical(expected)) throw new Error('RECEIPT_IMPLEMENTATION_BINDING_MISMATCH');
}

const GATE_NAMES = ['build', 'existing-suite', 'public-contract', 'public-oracle-v2'];
const GATE_REASON: Record<string, string> = {build: 'PUBLIC_BUILD_SEMANTIC_FAILURE', 'existing-suite': 'PUBLIC_EXISTING_SUITE_SEMANTIC_FAILURE',
  'public-contract': 'PUBLIC_CONTRACT_FAILURE', 'public-oracle-v2': 'PUBLIC_ORACLE_V2_FAILURE'};
const GATE_OPERATIONAL_REASON: Record<string, string> = {build: 'PUBLIC_BUILD_OPERATIONAL_FAILURE', 'existing-suite': 'PUBLIC_EXISTING_SUITE_OPERATIONAL_FAILURE',
  'public-contract': 'PUBLIC_CONTRACT_OPERATIONAL_FAILURE', 'public-oracle-v2': 'PUBLIC_ORACLE_V2_OPERATIONAL_FAILURE'};
const GATE_OPERATION = (gate: string) => gate === 'build' ? 'build' : gate === 'existing-suite' ? 'suite' : 'observe';
const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

function dockerRecord(value: any) {
  const commands = value?.commands;
  if (!isRecord(value) || value.version !== 1 || value.backend !== 'LOCAL_DOCKER_FALLBACK' ||
      !/^[a-f0-9]{64}$/i.test(value.containerId ?? '') || !/^[a-f0-9-]{36}$/.test(value.executionEvidenceId ?? '') ||
      !['build', 'suite', 'observe'].includes(value.operation) || !Array.isArray(commands) || commands.length !== 5 ||
      !validAfterOrEqual(value.startedAt, value.finishedAt) || value.createInvoked !== true || value.createExitCode !== 0 ||
      value.startAttachInvoked !== true || value.dockerClientExitCode !== 0 || value.inspectPerformed !== true || value.inspectExitCode !== 0 ||
      value.terminalState?.status !== 'exited' || value.terminalState?.running !== false || value.terminalState?.oomKilled !== false ||
      value.terminalState?.dead !== false || value.terminalState?.exitCode !== 0 ||
      canonical(value.policy) !== canonical({network: 'none', readOnlyRoot: true, nonRoot: true, capDropAll: true, noNewPrivileges: true,
        pidsLimit: 64, memoryLimit: '256m', cpuLimit: 1}) ||
      value.cleanup?.attempted !== true || value.cleanup?.removeExitCode !== 0 || value.cleanup?.removedContainerId !== value.containerId ||
      value.cleanup?.containerRemovalVerified !== true || value.cleanup?.verifyExitCode !== 0 || value.cleanup?.cleanupResult !== 'PASS') return false;
  const names = ['create', 'start', 'inspect', 'remove', 'verify-removed'];
  if (!commands.every((item: any, index: number) => item?.name === names[index] && item.exitCode === 0 &&
      Array.isArray(item.args) && item.args[0] === 'docker' && HASH.test(item.outputSha256 ?? ''))) return false;
  const create = commands[0].args as string[];
  const hasPair = (name: string, arg: string) => create.some((v, i) => v === name && create[i + 1] === arg);
  const count = (arg: string) => create.filter((v) => v === arg).length;
  if (!hasPair('--network', 'none') || !create.includes('--read-only') || !hasPair('--user', '10001:10001') ||
      !hasPair('--cap-drop', 'ALL') || !hasPair('--security-opt', 'no-new-privileges') || !hasPair('--pids-limit', '64') ||
      !hasPair('--memory', '256m') || !hasPair('--cpus', '1') || !hasPair('--tmpfs', '/tmp:rw,noexec,nosuid,size=16m') ||
      count('--network') !== 1 || count('--read-only') !== 1 || count('--user') !== 1 || count('--cap-drop') !== 1 ||
      count('--security-opt') !== 1 || count('--pids-limit') !== 1 || count('--memory') !== 1 || count('--cpus') !== 1 ||
      count('--tmpfs') !== 1 || count('--mount') !== 3 || create.includes('--privileged') || create.includes('--network=host') ||
      commands[1].args.join(' ') !== `docker start -a -i ${value.containerId}` ||
      commands[2].args[1] !== 'inspect' || commands[2].args.at(-1) !== value.containerId ||
      commands[3].args.join(' ') !== `docker rm -f ${value.containerId}` ||
      !commands[4].args.includes(`id=${value.containerId}`)) return false;
  const createEnd = create.indexOf(REPAIR_DOCKER_IMAGE);
  const result = value.result;
  let serializedResult: unknown;
  try { if (typeof value.startStdout !== 'string' || typeof value.startStderr !== 'string') return false; serializedResult = JSON.parse(value.startStdout.trim()); }
  catch { return false; }
  return createEnd > 0 && create[createEnd + 1] === 'node' && create[createEnd + 2] === '/runner.cjs' && create[createEnd + 3] === value.operation &&
    create.some((arg, index) => arg === '--mount' && (value.operation === 'build'
      ? /^type=bind,source=.+,target=\/candidate$/.test(create[index + 1] ?? '')
      : /^type=bind,source=.+,target=\/candidate,readonly$/.test(create[index + 1] ?? ''))) &&
    create.some((arg, index) => arg === '--mount' && /^type=bind,source=.+,target=\/deps\/node_modules,readonly$/.test(create[index + 1] ?? '')) &&
    create.some((arg, index) => arg === '--mount' && /^type=bind,source=.+,target=\/runner\.cjs,readonly$/.test(create[index + 1] ?? '')) &&
    commands[1].outputSha256 === sha256(value.startStdout + '\0' + value.startStderr) && canonical(serializedResult) === canonical(result) &&
    isRecord(result) && result.operation === value.operation && Number.isSafeInteger(result.exitCode) &&
    typeof result.operational === 'boolean' && HASH.test(result.outputSha256 ?? '') && HASH.test(result.runtimeSha256 ?? '') &&
    (!result.observation || isRecord(result.observation));
}

function validAfterOrEqual(start: unknown, end: unknown) {
  return typeof start === 'string' && typeof end === 'string' && Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(end)) && Date.parse(end) >= Date.parse(start);
}

const EXECUTION_CLOCK_SKEW_MS = 2000;

export function withinExecutionClockEnvelope(observationStartedAt: number, observationFinishedAt: number,
  executionStartedAt: string, executionFinishedAt: string) {
  const hostStart = Date.parse(executionStartedAt);
  const hostFinish = Date.parse(executionFinishedAt);
  return Number.isSafeInteger(observationStartedAt) && Number.isSafeInteger(observationFinishedAt) &&
    observationFinishedAt >= observationStartedAt && Number.isSafeInteger(hostStart) && Number.isSafeInteger(hostFinish) &&
    hostFinish >= hostStart && observationStartedAt >= hostStart - EXECUTION_CLOCK_SKEW_MS &&
    observationFinishedAt <= hostFinish + EXECUTION_CLOCK_SKEW_MS &&
    observationFinishedAt - observationStartedAt <= hostFinish - hostStart + 2 * EXECUTION_CLOCK_SKEW_MS;
}

function lifecycleValid(events: any[], publicPass: boolean) {
  const prefix = ['MODEL_RESULT_RECEIVED', 'PUBLIC_EVALUATION_COMPLETED'];
  const full = [...prefix, 'CANDIDATE_FROZEN', 'HOLDOUT_CREATED', 'HOLDOUT_SEALED', 'BLIND_EXECUTION_STARTED', 'BLIND_EXECUTION_COMPLETED'];
  const expected = publicPass ? full : prefix;
  if (!Array.isArray(events) || events.length !== expected.length || events.some((event, index) => event.sequence !== index ||
      event.event !== expected[index] || !Number.isFinite(Date.parse(event.at)))) return false;
  for (let index = 1; index < events.length; index++) if (Date.parse(events[index].at) < Date.parse(events[index - 1].at)) return false;
  if (publicPass && (Date.parse(events[2].at) >= Date.parse(events[3].at) || Date.parse(events[3].at) > Date.parse(events[4].at) ||
      Date.parse(events[5].at) < Date.parse(events[4].at) || Date.parse(events[6].at) < Date.parse(events[5].at))) return false;
  return true;
}

function deriveBlindOutcome(input: {runId: string; candidateHash: string; backend: RepairBackend; seal: string; holdout: any; blind: any;
  executionById: Map<string, any>; sealedAt: string; blindStartedAt: string; blindCompletedAt: string}): BlindOutcome {
  const challenges = input.holdout?.challenges;
  const rows = input.blind?.blindResults;
  if (!Array.isArray(challenges) || !challenges.length || input.holdout.runId !== input.runId ||
      input.holdout.generatorVersion !== 'positive-expiry-v1' || !Array.isArray(rows) ||
      input.blind.challengeCount !== challenges.length) throw new Error('RECEIPT_BLIND_HOLDOUT_INVALID');
  const challengeById = new Map<string, any>();
  for (const challenge of challenges) {
    if (!isRecord(challenge) || typeof challenge.challengeId !== 'string' || !HASH.test(challenge.challengeId) ||
        typeof challenge.key !== 'string' || !challenge.key || typeof challenge.value !== 'string' ||
        !Number.isSafeInteger(challenge.updatedTtlSeconds) || challenge.updatedTtlSeconds < 1 ||
        !Number.isSafeInteger(challenge.initialTtlSeconds) || challenge.initialTtlSeconds < 1) throw new Error('RECEIPT_BLIND_CHALLENGE_INVALID');
    const {challengeId, ...body} = challenge;
    if (sha256(canonical(body)) !== challengeId || challengeById.has(challengeId)) throw new Error('RECEIPT_BLIND_CHALLENGE_INVALID');
    challengeById.set(challengeId, body);
  }
  const rowIds = new Set<string>();
  if (rows.length !== challenges.length) throw new Error('RECEIPT_BLIND_CHALLENGE_SET_INVALID');
  let incomplete = false;
  let failed = false;
  for (const row of rows) {
    if (!isRecord(row) || row.runId !== input.runId || row.candidateHash !== input.candidateHash || row.holdoutSeal !== input.seal ||
        row.backend !== input.backend || !challengeById.has(row.challengeId) || rowIds.has(row.challengeId)) throw new Error('RECEIPT_BLIND_ROW_BINDING_INVALID');
    rowIds.add(row.challengeId);
    if (!validAfterOrEqual(row.startedAt, row.endedAt)) {
      throw new Error('RECEIPT_BLIND_BEFORE_SEAL');
    }
    if (!/^[a-f0-9-]{36}$/.test(row.executionEvidenceId ?? '')) throw new Error('RECEIPT_BLIND_EXECUTION_MISSING');
    const execution = input.executionById.get(row.executionEvidenceId);
    if (!execution || execution.operation !== 'observe' || execution.backend !== input.backend ||
        !validAfterOrEqual(execution.startedAt, execution.finishedAt)) throw new Error('RECEIPT_BLIND_EXECUTION_MISMATCH');
    if (Date.parse(execution.startedAt) < Date.parse(input.sealedAt) || Date.parse(execution.startedAt) < Date.parse(input.blindStartedAt) ||
        Date.parse(execution.finishedAt) > Date.parse(input.blindCompletedAt)) throw new Error('RECEIPT_BLIND_BEFORE_SEAL');
    if (execution.result.exitCode !== row.exitCode || execution.result.runtimeSha256 !== row.runtimeSha256 ||
        canonical(execution.command) !== canonical(row.command) || !Number.isSafeInteger(execution.result.observationStartedAt) ||
        !Number.isSafeInteger(execution.result.observationFinishedAt) ||
        Date.parse(row.startedAt) !== execution.result.observationStartedAt || Date.parse(row.endedAt) !== execution.result.observationFinishedAt ||
        !withinExecutionClockEnvelope(execution.result.observationStartedAt, execution.result.observationFinishedAt,
          execution.startedAt, execution.finishedAt)) throw new Error('RECEIPT_BLIND_EXECUTION_MISMATCH');
    if (row.operationalResult === 'EXECUTION_ERROR') {
      if (row.semanticResult !== null || row.observation !== null || !execution.result.operational && execution.result.exitCode === 0) {
        throw new Error('RECEIPT_BLIND_OPERATIONAL_ROW_INVALID');
      }
      incomplete = true;
      continue;
    }
    if (row.operationalResult !== 'EXECUTION_PASS' || execution.result.operational || execution.result.exitCode !== 0 ||
        !isRecord(row.observation) || canonical(execution.result.observation) !== canonical(row.observation) ||
        sha256(canonical(row.observation)) !== row.observationSha256) throw new Error('RECEIPT_BLIND_OBSERVATION_INVALID');
    const challenge = challengeById.get(row.challengeId);
    const derived = deriveBlindSemanticResult(challenge, row.observation, Date.parse(row.startedAt), Date.parse(row.endedAt));
    if (row.semanticResult !== derived) throw new Error('RECEIPT_BLIND_SEMANTIC_MISMATCH');
    failed ||= derived === 'SEMANTIC_FAIL';
  }
  for (const id of rowIds) if (!challengeById.has(id)) throw new Error('RECEIPT_BLIND_UNKNOWN_CHALLENGE');
  if (incomplete) return 'INCONCLUSIVE';
  return failed ? 'FAIL' : 'PASS';
}

function providerEvidence(root: string, publicObjects: EvidenceObject[], privateRefs: EvidenceObject[], pub: Record<string, any>) {
  const requestRef = privateRefs.find((item) => item.role === 'model-request-package')!;
  const responseRef = privateRefs.find((item) => item.role === 'model-response')!;
  const contentRef = privateRefs.find((item) => item.role === 'model-response-content')!;
  const validatedRef = privateRefs.find((item) => item.role === 'validated-model-response');
  const meta = parseObject(root, privateRefs, 'provider-metadata');
  const catalog = parseObject(root, publicObjects, 'live-model-catalog');
  const requestBytes = readObject(root, requestRef, 'private');
  const rawResponseBytes = readObject(root, responseRef, 'private');
  if (!validatedRef) throw new Error('RECEIPT_VALIDATED_RESPONSE_MISSING');
  const validatedBytes = readObject(root, validatedRef, 'private');
  const request = parseJson(requestBytes, 'RECEIPT_REQUEST_PACKAGE_INVALID');
  const projectionManifest = parseObject(root, privateRefs, 'projection-manifest');
  const envelope = parseJson(rawResponseBytes, 'RECEIPT_PROVIDER_ENVELOPE_INVALID');
  const rawResponse = readObject(root, contentRef, 'private').toString('utf8');
  const validated = parseJson(validatedBytes, 'RECEIPT_VALIDATED_RESPONSE_INVALID');
  const http = parseObject(root, privateRefs, 'provider-http-evidence');
  const choice = envelope?.choices?.[0];
  const message = choice?.message;
  const responseHeaders = http?.responseHeaders;
  const safeHeader = (value: unknown) => value === null || value === undefined ||
    typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
  const envelopeRequestId = typeof envelope?.id === 'string' && envelope.id.length > 0 ? envelope.id : null;
  const headerRequestId = responseHeaders?.xRequestId || responseHeaders?.requestId || null;
  const derivedRequestId = headerRequestId ?? envelopeRequestId ?? 'UNKNOWN';
  const derivedOperationId = responseHeaders?.operationId || 'UNKNOWN';
  const derivedUsage = envelope?.usage === undefined ? 'UNKNOWN'
    : isRecord(envelope.usage) && Number.isSafeInteger(envelope.usage.prompt_tokens) &&
      Number.isSafeInteger(envelope.usage.completion_tokens) && Number.isSafeInteger(envelope.usage.total_tokens)
      ? {prompt: envelope.usage.prompt_tokens, completion: envelope.usage.completion_tokens, total: envelope.usage.total_tokens} : null;
  const checked = validateRepairProposal(rawResponse, request.baseFileSha256);
  try { verifyRepairRequestContext(request, projectionManifest); }
  catch { throw new Error('RECEIPT_REQUEST_CONTEXT_INVALID'); }
  if (request.caseId !== 'node-cache-ttl-zero-001' || !Array.isArray(request.publicContextFiles) ||
      typeof message?.content !== 'string' || message.content !== rawResponse || canonical(checked.proposal) !== canonical(validated) || checked.validatedSha256 !== validatedRef.sha256 ||
      requestRef.sha256 !== pub.requestPackageSha256 || requestRef.sha256 !== pub.modelRequestPackageSha256 ||
      responseRef.sha256 !== pub.responseSha256 || validatedRef.sha256 !== pub.validatedResponseSha256 ||
      !isRecord(envelope) || envelope.model !== request.model || choice?.finish_reason !== 'stop' || message?.refusal ||
      meta.provider !== 'Nebius' || meta.requestPackageSha256 !== requestRef.sha256 || meta.responseSha256 !== responseRef.sha256 ||
      meta.validatedResponseSha256 !== validatedRef.sha256 || meta.requestedModel !== request.model || meta.returnedModel !== envelope.model ||
      !catalog.nvidia?.some((model: any) => model.id === request.model) || catalog.selected !== request.model ||
      !isRecord(http) || http.version !== 1 ||
      http.endpoint !== meta.requestEndpoint || http.status !== 200 ||
      canonical(http.requestHeaders) !== canonical({accept: 'application/json', 'content-type': 'application/json'}) ||
      !isRecord(responseHeaders) || Object.keys(responseHeaders).some((key) => !['contentType', 'xRequestId', 'requestId', 'operationId'].includes(key)) ||
      !Object.values(responseHeaders).every(safeHeader) || typeof responseHeaders.contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(responseHeaders.contentType) ||
      http.networkAttempts !== 1 ||
      !(http.recoveredNetworkCause === 'NONE' || ['ENOTFOUND', 'EAI_AGAIN'].includes(http.recoveredNetworkCause)) ||
      meta.model !== undefined || meta.finishReason !== choice?.finish_reason || derivedUsage === null || canonical(meta.usage) !== canonical(derivedUsage) ||
      meta.networkAttempts !== http.networkAttempts || meta.recoveredNetworkCause !== http.recoveredNetworkCause ||
      meta.requestId !== derivedRequestId || meta.operationId !== derivedOperationId ||
      !(meta.requestId === 'UNKNOWN' || typeof meta.requestId === 'string' && meta.requestId.length > 0) ||
      !(meta.operationId === 'UNKNOWN' || typeof meta.operationId === 'string' && meta.operationId.length > 0) ||
      (meta.recoveredNetworkCause !== 'NONE' && !/^[A-Z0-9_]{1,80}$/.test(meta.recoveredNetworkCause ?? '')) ||
      typeof meta.baseEndpoint !== 'string' || typeof meta.requestEndpoint !== 'string') throw new Error('RECEIPT_PROVIDER_BINDING_INVALID');
  let endpoint: URL;
  let expectedEndpoint: URL;
  try {
    const base = resolveTokenFactoryBaseUrl(meta.baseEndpoint);
    endpoint = new URL(meta.requestEndpoint);
    expectedEndpoint = new URL('chat/completions', base);
  }
  catch { throw new Error('RECEIPT_PROVIDER_ENDPOINT_INVALID'); }
  if (endpoint.toString() !== expectedEndpoint.toString() || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || pub.provider !== meta.provider || pub.baseEndpoint !== meta.baseEndpoint ||
      pub.requestEndpoint !== meta.requestEndpoint || pub.model !== meta.requestedModel || pub.returnedModel !== meta.returnedModel ||
      pub.requestId !== meta.requestId || pub.operationId !== meta.operationId || pub.finishReason !== meta.finishReason ||
      canonical(pub.usage) !== canonical(meta.usage) || pub.networkAttempts !== meta.networkAttempts ||
      pub.recoveredNetworkCause !== meta.recoveredNetworkCause || pub.requestPackageSha256 !== requestRef.sha256 ||
      pub.modelRequestPackageSha256 !== requestRef.sha256 || pub.responseSha256 !== responseRef.sha256 ||
      pub.validatedResponseSha256 !== validatedRef.sha256) throw new Error('RECEIPT_PROVIDER_SUMMARY_MISMATCH');
  return {request, meta, validated, requestRef, responseRef, validatedRef};
}

function validateGateEvidence(gates: any, request: any, executions: Map<string, any>, backend: RepairBackend, candidateHash: string) {
  if (!Array.isArray(gates) || gates.length !== GATE_NAMES.length || gates.some((item, index) => item?.gate !== GATE_NAMES[index])) {
    throw new Error('RECEIPT_GATE_EVIDENCE_INVALID');
  }
  const contexts = new Map((request.publicContextFiles ?? []).map((item: any) => [item.path, item]));
  const contextJson = (name: string) => {
    const row: any = contexts.get('candidate/' + name);
    if (!row || typeof row.content !== 'string' || sha256(row.content) !== row.sha256) throw new Error('RECEIPT_PUBLIC_CONTEXT_INVALID');
    return JSON.parse(row.content);
  };
  const witness = contextJson('witness.json');
  const contract = contextJson('contract-v3.json');
  const oracle = contextJson('oracle-v2.json');
  const outcomes = [];
  const references = new Set<string>();
  let earlierFailure = false;
  for (const row of gates) {
    if (row.backend !== backend || row.candidateHash !== candidateHash || !HASH.test(row.outputSha256 ?? '') ||
        !HASH.test(row.runtimeSha256 ?? '') || !Number.isSafeInteger(row.exitCode) || !Array.isArray(row.command) || !row.command.length) {
      throw new Error('RECEIPT_GATE_EVIDENCE_INVALID');
    }
    let derived: string;
    if (row.semantic === 'NOT_RUN') {
      if (!earlierFailure || row.executionEvidenceId !== null || row.failureKind !== 'SKIPPED' || row.reasonCode !== null) throw new Error('RECEIPT_GATE_SKIP_INVALID');
      derived = 'NOT_RUN';
    } else {
      const execution = executions.get(row.executionEvidenceId);
      const operation = GATE_OPERATION(row.gate);
      if (!execution || execution.operation !== operation || execution.backend !== backend) throw new Error('RECEIPT_GATE_EXECUTION_MISSING');
      references.add(row.executionEvidenceId);
      if (canonical(execution.command) !== canonical(row.command) || execution.result.runtimeSha256 !== row.runtimeSha256) throw new Error('RECEIPT_GATE_EXECUTION_MISMATCH');
      if (operation === 'build' || operation === 'suite') {
        if (execution.result.outputSha256 !== row.outputSha256 || execution.result.exitCode !== row.exitCode) throw new Error('RECEIPT_GATE_EXECUTION_MISMATCH');
        derived = execution.result.operational ? 'ERROR' : execution.result.exitCode === 0 ? 'PASS' : 'FAIL';
      } else {
        const observation = row.observation;
        if (!isRecord(observation) || !Number.isSafeInteger(row.observationStartedAt) || !Number.isSafeInteger(row.observationFinishedAt) ||
            row.observationFinishedAt < row.observationStartedAt || canonical(execution.result.observation) !== canonical(observation) ||
            execution.result.observationStartedAt !== row.observationStartedAt || execution.result.observationFinishedAt !== row.observationFinishedAt ||
            !withinExecutionClockEnvelope(row.observationStartedAt, row.observationFinishedAt, execution.startedAt, execution.finishedAt) ||
            row.outputSha256 !== sha256(canonical({observation, startedAt: row.observationStartedAt, finishedAt: row.observationFinishedAt}))) {
          throw new Error('RECEIPT_PUBLIC_OBSERVATION_INVALID');
        }
        if (execution.result.operational) derived = 'ERROR';
        else if (row.gate === 'public-contract') {
          const clauses = Object.values(contract.clauses ?? {}).flat() as any[];
          const supported = clauses.filter((item) => item?.status === 'SOURCE_SUPPORTED').map((item) => item.id);
          const bindingPass = contract.id === 'node-cache-ttl-zero-001' && contract.version === 3 &&
            ['ttl-zero-refreshes-without-expiry', 'ttl-zero-never-deletes'].every((id) => supported.includes(id)) &&
            Array.isArray(witness.contractClauseIds) && witness.contractClauseIds.includes('ttl-zero-refreshes-without-expiry') &&
            witness.contractClauseIds.includes('ttl-zero-never-deletes');
          derived = bindingPass && canonical(observation) === canonical(witness.expectedObservation) ? 'PASS' : 'FAIL';
        } else derived = evaluateObservation(observation, {...oracle, visibility: 'PUBLIC'});
      }
      if (row.exitCode !== execution.result.exitCode) throw new Error('RECEIPT_GATE_EXIT_CODE_MISMATCH');
    }
    if (row.semantic !== derived) throw new Error('RECEIPT_GATE_SEMANTIC_MISMATCH');
    const expectedKind = derived === 'PASS' ? 'NONE' : derived === 'FAIL' ? 'SEMANTIC' : derived === 'ERROR' ? 'OPERATIONAL' : 'SKIPPED';
    const expectedReason = derived === 'FAIL' ? GATE_REASON[row.gate] : derived === 'ERROR' ? GATE_OPERATIONAL_REASON[row.gate] : null;
    if (row.failureKind !== expectedKind || row.reasonCode !== expectedReason ||
        (derived === 'PASS' && row.exitCode !== 0)) throw new Error('RECEIPT_GATE_CLASSIFICATION_INVALID');
    earlierFailure ||= derived === 'FAIL' || derived === 'ERROR';
    outcomes.push({gate: row.gate, result: derived, exitCode: row.exitCode, failureKind: expectedKind, reasonCode: expectedReason});
  }
  return {outcomes, references};
}

function assertV5Semantics(root: string, pub: Record<string, any>, priv: Record<string, any>, binding: ImplementationBinding) {
  assertBindingMatches(pub, binding); assertBindingMatches(priv, binding);
  if (priv.implementationSha !== pub.implementationSha || priv.implementationTreeSha !== pub.implementationTreeSha ||
      canonical(priv.implementationFiles) !== canonical(pub.implementationFiles) || priv.candidateHash !== pub.candidateHash ||
      priv.decision !== pub.decision || priv.jobStatus !== pub.jobStatus || canonical(priv.candidateResult) !== canonical(pub.candidateResult) ||
      priv.experimentIntegrity !== pub.experimentIntegrity || priv.milestone !== pub.milestone || pub.status !== pub.milestone ||
      canonical(priv.reasonCodes) !== canonical(pub.reasonCodes) || canonical(priv.operationalFailure ?? null) !== canonical(pub.operationalFailure ?? null) ||
      priv.executionBackend !== pub.executionBackend) throw new Error('PRIVATE_RECEIPT_BINDING_MISMATCH');
  if (!DECISIONS.has(pub.decision) || !Array.isArray(pub.reasonCodes) || !pub.candidateResult ||
      pub.candidateResult.decision !== pub.decision || pub.candidateResult.jobStatus !== pub.jobStatus ||
      canonical(pub.candidateResult.reasonCodes) !== canonical(pub.reasonCodes)) throw new Error('RECEIPT_DECISION_BINDING_INVALID');

  const privateRefs = priv.objects as EvidenceObject[];
  const privateRoles = privateRefs.map((item) => item.role);
  const publicRoles = pub.publicObjects.map((item: EvidenceObject) => item.role);
  if (new Set(privateRoles).size !== privateRoles.length || new Set(publicRoles).size !== publicRoles.length) {
    throw new Error('RECEIPT_EVIDENCE_ROLE_DUPLICATE');
  }
  if (pub.operationalFailure && pub.executionBackend === undefined) {
    const summary = parseObject(root, pub.publicObjects, 'terminal-summary');
    const failure = parseObject(root, privateRefs, 'terminal-failure');
    if (!publicRoles.includes('terminal-summary') || !privateRoles.includes('terminal-failure') || pub.status !== 'CAT_P05S_BLOCKED' ||
        pub.jobStatus !== 'INCONCLUSIVE' || pub.decision !== null || pub.experimentIntegrity !== 'INCOMPLETE' ||
        !pub.operationalFailure.code || pub.operationalFailure.code !== pub.reasonCodes[0] || pub.milestone !== 'CAT_P05S_BLOCKED' ||
        priv.executionBackend !== undefined || summary.runId !== pub.runId || summary.status !== pub.status ||
        summary.candidateHash !== pub.candidateHash || canonical(summary.candidateResult) !== canonical(pub.candidateResult) ||
        canonical(summary.operationalFailure) !== canonical(pub.operationalFailure) || canonical(summary.reasonCodes) !== canonical(pub.reasonCodes) ||
        failure.runId !== pub.runId || failure.implementationSha !== pub.implementationSha || failure.stage !== pub.operationalFailure.stage ||
        failure.code !== pub.operationalFailure.code || failure.decision !== null) throw new Error('RECEIPT_OPERATIONAL_FAILURE_INVALID');
    return;
  }

  for (const role of ['projection-summary', 'live-model-catalog', 'public-run-summary']) if (!publicRoles.includes(role)) throw new Error('RECEIPT_REQUIRED_EVIDENCE_MISSING');
  for (const role of ['projection-manifest', 'backend-attestation', 'model-request-package', 'model-response', 'model-response-content', 'validated-model-response',
    'provider-http-evidence', 'provider-metadata', 'public-gate-evidence', 'docker-lifecycle-evidence', 'lifecycle-events']) {
    if (!privateRoles.includes(role)) throw new Error('RECEIPT_REQUIRED_EVIDENCE_MISSING');
  }
  const backend = pub.executionBackend as RepairBackend;
  if (backend !== 'LOCAL_DOCKER_FALLBACK') throw new Error('RECEIPT_SANDBOX_BACKEND_UNVERIFIED');
  const publicRun = parseObject(root, pub.publicObjects, 'public-run-summary');
  const attestation = parseObject(root, privateRefs, 'backend-attestation');
  const probe = attestation.sandboxProbe;
  const sandboxReason: Record<string, string[]> = {SANDBOX_CLIENT_UNAVAILABLE: ['OFFICIAL_CLIENT_NOT_FOUND', 'WORKSPACE_CLIENT_REJECTED'],
    SANDBOX_AUTH_MISSING: ['SANDBOX_AUTH_MISSING'], SANDBOX_PROJECT_MISSING: ['SANDBOX_PROJECT_MISSING'],
    SANDBOX_CAPABILITY_UNAVAILABLE: ['CANDIDATE_EGRESS_ISOLATION_UNATTESTED']};
  if (attestation.backend !== backend || priv.executionBackend !== backend || publicRun.backend !== backend ||
      attestation.sandboxStatus !== pub.sandboxStatus || attestation.sandboxStatus !== priv.sandboxStatus ||
      (attestation.sandboxOperationId ?? null) !== (pub.sandboxOperationId ?? null) ||
      (attestation.sandboxOperationId ?? null) !== (priv.sandboxOperationId ?? null) ||
      !isRecord(probe) || probe.version !== 1 || probe.provider !== 'Nebius' || probe.status !== attestation.sandboxStatus ||
      probe.auth !== attestation.sandboxAuth || probe.project !== attestation.sandboxProject ||
      (probe.operationId ?? null) !== (attestation.sandboxOperationId ?? null) ||
      (probe.evidenceSha256 ?? null) !== (attestation.sandboxEvidenceSha256 ?? null) || probe.reason !== attestation.sandboxReason ||
      !sandboxReason[attestation.sandboxStatus]?.includes(attestation.sandboxReason) ||
      !['UNKNOWN', 'CONFIGURED', 'MISSING'].includes(attestation.sandboxAuth) ||
      !['UNKNOWN', 'CONFIGURED', 'MISSING'].includes(attestation.sandboxProject) ||
      attestation.network !== 'none' || attestation.image !== REPAIR_DOCKER_IMAGE || !attestation.dockerVersion ||
      !HASH.test(attestation.dockerHostSha256 ?? '') || attestation.readOnlyRoot !== true || attestation.nonRoot !== true ||
      attestation.capDrop !== 'ALL' || attestation.pidsLimit !== 64 || attestation.memoryLimit !== '256m' || attestation.cpuLimit !== 1 ||
      attestation.sandboxStatus === 'READY' || !attestation.sandboxReason ||
      attestation.sandboxReason !== priv.sandboxBlockerReason || attestation.sandboxOperationId ||
      (attestation.sandboxEvidenceSha256 !== null && !HASH.test(attestation.sandboxEvidenceSha256 ?? '')) ||
      (pub.sandboxEvidenceSha256 ?? null) !== (attestation.sandboxEvidenceSha256 ?? null)) throw new Error('RECEIPT_BACKEND_ATTESTATION_MISMATCH');
  // Local probe summaries are diagnostic until a trusted Sandbox attestor binds them.
  const sandboxBlockerValid = false;

  const gateRef = privateRefs.find((item) => item.role === 'public-gate-evidence')!;
  const dockerRef = privateRefs.find((item) => item.role === 'docker-lifecycle-evidence')!;
  const lifecycleRef = privateRefs.find((item) => item.role === 'lifecycle-events')!;
  for (const digest of [pub.requestPackageSha256, pub.modelRequestPackageSha256, pub.responseSha256, pub.validatedResponseSha256,
    pub.patchSha256, pub.candidateHash, priv.publicGateEvidenceSha256, priv.dockerEvidenceSha256, priv.lifecycleEventsSha256]) {
    if (!HASH.test(digest ?? '')) throw new Error('RECEIPT_REQUIRED_HASH_INVALID');
  }
  if (gateRef.sha256 !== priv.publicGateEvidenceSha256 || dockerRef.sha256 !== priv.dockerEvidenceSha256 ||
      lifecycleRef.sha256 !== priv.lifecycleEventsSha256 || !priv.patchApplication || priv.patchApplication.patchSha256 !== pub.patchSha256) {
    throw new Error('RECEIPT_PHASE_HASH_MISMATCH');
  }
  const provider = providerEvidence(root, pub.publicObjects, privateRefs, pub);
  if (priv.modelRequestObjectId !== provider.requestRef.id || priv.modelResponseObjectId !== provider.responseRef.id ||
      priv.modelResponseContentObjectId !== privateRefs.find((item) => item.role === 'model-response-content')?.id ||
      priv.requestPackageSha256 !== provider.requestRef.sha256 || priv.modelRequestPackageSha256 !== provider.requestRef.sha256 ||
      priv.responseSha256 !== provider.responseRef.sha256 || priv.validatedResponseSha256 !== provider.validatedRef.sha256 ||
      priv.provider?.provider !== provider.meta.provider || priv.provider?.requestedModel !== provider.meta.requestedModel ||
      priv.provider?.returnedModel !== provider.meta.returnedModel || priv.provider?.requestId !== provider.meta.requestId ||
      priv.provider?.operationId !== provider.meta.operationId || priv.provider?.requestPackageSha256 !== provider.requestRef.sha256 ||
      priv.provider?.responseSha256 !== provider.responseRef.sha256 || priv.provider?.validatedResponseSha256 !== provider.validatedRef.sha256) {
    throw new Error('RECEIPT_PROVIDER_BINDING_INVALID');
  }

  const docker = parseObject(root, privateRefs, 'docker-lifecycle-evidence');
  if (docker.version !== 1 || docker.backend !== backend || !Array.isArray(docker.executions)) throw new Error('RECEIPT_DOCKER_EVIDENCE_INVALID');
  const executions = new Map<string, any>();
  for (const value of docker.executions) {
    if (!dockerRecord(value) || executions.has(value.executionEvidenceId)) throw new Error('RECEIPT_DOCKER_LIFECYCLE_INVALID');
    executions.set(value.executionEvidenceId, value);
  }
  const gateBytes = readObject(root, gateRef, 'private');
  const gateEvidence = parseJson(gateBytes, 'RECEIPT_GATE_EVIDENCE_INVALID');
  if (canonical(gateEvidence) !== canonical(priv.publicEvidence)) throw new Error('RECEIPT_PUBLIC_GATE_BINDING_MISMATCH');
  const gates = validateGateEvidence(gateEvidence, provider.request, executions, backend, pub.candidateHash);
  const publicOutcomes = gates.outcomes.map(({gate, result, exitCode}) => ({gate, result, exitCode}));
  if (canonical(publicOutcomes) !== canonical(pub.publicOutcomes) || canonical(publicOutcomes) !== canonical(publicRun.publicOutcomes)) {
    throw new Error('RECEIPT_PUBLIC_GATE_BINDING_MISMATCH');
  }

  const lifecycleEvents = parseObject(root, privateRefs, 'lifecycle-events');
  const publicPass = gates.outcomes.every((item) => item.result === 'PASS');
  if (!lifecycleValid(lifecycleEvents, publicPass)) throw new Error('RECEIPT_LIFECYCLE_ORDER_INVALID');
  if (publicRun.status !== pub.status || publicRun.milestone !== pub.milestone ||
      canonical(publicRun.candidateResult) !== canonical(pub.candidateResult) || publicRun.experimentIntegrity !== pub.experimentIntegrity ||
      publicRun.decision !== pub.decision || publicRun.candidateAccepted !== pub.candidateAccepted ||
      publicRun.candidateHash !== pub.candidateHash || publicRun.requestPackageSha256 !== pub.requestPackageSha256 ||
      publicRun.modelRequestPackageSha256 !== pub.modelRequestPackageSha256 ||
      publicRun.responseSha256 !== pub.responseSha256 || publicRun.validatedResponseSha256 !== pub.validatedResponseSha256 ||
      publicRun.patchSha256 !== pub.patchSha256 || publicRun.blindResult !== pub.blindResult ||
      publicRun.holdoutChallengeCount !== pub.holdoutChallengeCount || publicRun.provider !== pub.provider ||
      publicRun.jobStatus !== pub.jobStatus || canonical(publicRun.reasonCodes) !== canonical(pub.reasonCodes) ||
      publicRun.backend !== pub.executionBackend || publicRun.candidateFrozenAt !== (pub.candidateFrozenAt ?? null) ||
      publicRun.frozenCandidateHash !== (pub.frozenCandidateHash ?? null) || publicRun.seedCreatedAt !== (pub.seedCreatedAt ?? null) ||
      publicRun.holdoutCreatedAt !== (pub.holdoutCreatedAt ?? null) || publicRun.holdoutSeal !== (pub.holdoutSeal ?? null) ||
      publicRun.sandboxStatus !== pub.sandboxStatus || (publicRun.sandboxOperationId ?? null) !== (pub.sandboxOperationId ?? null) ||
      (publicRun.sandboxEvidenceSha256 ?? null) !== (pub.sandboxEvidenceSha256 ?? null) ||
      publicRun.baseEndpoint !== pub.baseEndpoint || publicRun.requestEndpoint !== pub.requestEndpoint ||
      publicRun.model !== pub.model || publicRun.returnedModel !== pub.returnedModel || publicRun.requestId !== pub.requestId ||
      publicRun.operationId !== pub.operationId || publicRun.finishReason !== pub.finishReason ||
      canonical(publicRun.usage) !== canonical(pub.usage) || publicRun.networkAttempts !== pub.networkAttempts ||
      publicRun.recoveredNetworkCause !== pub.recoveredNetworkCause ||
      canonical(publicRun.operationalFailure ?? null) !== canonical(pub.operationalFailure ?? null)) throw new Error('RECEIPT_SUMMARY_MISMATCH');

  let blindOutcome: BlindOutcome = 'NOT_RUN';
  let freezeValid = false, holdoutValid = false;
  const frozenManifest = parseObject(root, privateRefs, 'frozen-candidate-manifest', false);
  const sealedRef = privateRefs.find((item) => item.role === 'sealed-holdout');
  const blindEvidence = parseObject(root, privateRefs, 'blind-gate-evidence', false);
  if (!publicPass) {
    if (frozenManifest || sealedRef || blindEvidence || pub.candidateFrozenAt || pub.seedCreatedAt || pub.holdoutSeal || pub.holdoutCreatedAt ||
        pub.blindResult !== 'NOT_RUN' || pub.holdoutChallengeCount !== 0) throw new Error('RECEIPT_UNEXPECTED_HOLDOUT_EVIDENCE');
  } else {
    if (!frozenManifest || !sealedRef || !blindEvidence || !HASH.test(pub.frozenCandidateHash ?? '') ||
        !HASH.test(pub.holdoutSeal ?? '') || sealedRef.sha256 !== pub.holdoutSeal || sealedRef.sha256 !== priv.holdoutSeal ||
        !validAfterOrEqual(pub.candidateFrozenAt, pub.seedCreatedAt) || !validAfterOrEqual(pub.seedCreatedAt, pub.holdoutCreatedAt) ||
        pub.seedCreatedAt !== priv.seedCreatedAt || pub.holdoutCreatedAt !== priv.holdoutCreatedAt || priv.holdoutObjectId !== sealedRef.id ||
        pub.holdoutChallengeCount !== priv.holdoutChallengeCount ||
        privateRefs.find((item) => item.role === 'frozen-candidate-manifest')?.sha256 !== priv.frozenCandidateManifestSha256 ||
        frozenManifest.candidateHash !== pub.candidateHash || frozenManifest.candidateHash !== pub.frozenCandidateHash ||
        frozenManifest.candidateFrozenAt !== pub.candidateFrozenAt || frozenManifest.implementationSha !== pub.implementationSha ||
        frozenManifest.implementationTreeSha !== pub.implementationTreeSha || frozenManifest.executionBackend !== backend ||
        !Array.isArray(frozenManifest.rows) || !frozenManifest.rows.length ||
        blindEvidence.backend !== backend || blindEvidence.candidateHash !== pub.candidateHash || blindEvidence.holdoutSeal !== pub.holdoutSeal ||
        blindEvidence.candidateFrozenAt !== pub.candidateFrozenAt || blindEvidence.seedCreatedAt !== pub.seedCreatedAt ||
        blindEvidence.holdoutCreatedAt !== pub.holdoutCreatedAt) throw new Error('RECEIPT_HOLDOUT_BINDING_INVALID');
    const rows = frozenManifest.rows.map((row: any) => {
      if (normalizeProjectionPath(row.path) !== row.path || !HASH.test(row.sha256 ?? '') ||
          row.objectId !== `private/objects/${row.sha256}.bin` ||
          !privateRefs.some((item) => item.role === 'frozen-candidate-file' && item.id === row.objectId && item.sha256 === row.sha256)) {
        throw new Error('RECEIPT_FROZEN_FILE_INVALID');
      }
      return {path: row.path, sha256: row.sha256};
    });
    if (rows.some((row: any, index: number) => index > 0 && rows[index - 1].path >= row.path) || sha256(canonical(rows)) !== pub.frozenCandidateHash) {
      throw new Error('RECEIPT_FROZEN_CANDIDATE_HASH_MISMATCH');
    }
    const proposal = provider.validated;
    const resultFileSha256 = sha256(proposal.replacementText);
    const expectedPatchSha256 = sha256(canonical({path: REPAIR_MODIFIABLE_PATH, baseFileSha256: proposal.baseSha256, resultFileSha256}));
    if (proposal.baseSha256 !== provider.request.baseFileSha256 ||
        !provider.request.publicContextFiles.some((item: any) => item.path === 'candidate/' + REPAIR_MODIFIABLE_PATH && item.sha256 === proposal.baseSha256) ||
        canonical(priv.patchApplication.changedPaths) !== canonical([REPAIR_MODIFIABLE_PATH]) ||
        priv.patchApplication.baseFileSha256 !== proposal.baseSha256 || priv.patchApplication.resultFileSha256 !== resultFileSha256 ||
        priv.patchApplication.patchSha256 !== expectedPatchSha256 || pub.patchSha256 !== expectedPatchSha256 ||
        rows.find((row: any) => row.path === REPAIR_MODIFIABLE_PATH)?.sha256 !== resultFileSha256) {
      throw new Error('RECEIPT_PATCH_APPLICATION_INVALID');
    }
    const holdout = parseJson(readObject(root, sealedRef, 'private'), 'RECEIPT_HOLDOUT_INVALID');
    if (holdout.challenges?.length !== pub.holdoutChallengeCount || pub.holdoutChallengeCount < 1) throw new Error('RECEIPT_HOLDOUT_CHALLENGE_COUNT_INVALID');
    if (lifecycleEvents[2]?.at !== pub.candidateFrozenAt || lifecycleEvents[3]?.at !== pub.seedCreatedAt ||
        lifecycleEvents[4]?.at !== pub.holdoutCreatedAt) throw new Error('RECEIPT_LIFECYCLE_EVIDENCE_MISMATCH');
    freezeValid = pub.candidateHash === pub.frozenCandidateHash;
    holdoutValid = true;
    blindOutcome = deriveBlindOutcome({runId: pub.runId, candidateHash: pub.frozenCandidateHash, backend, seal: pub.holdoutSeal,
      holdout, blind: blindEvidence, executionById: executions, sealedAt: pub.holdoutCreatedAt,
      blindStartedAt: lifecycleEvents[5].at, blindCompletedAt: lifecycleEvents[6].at});
  }
  const usedIds = new Set(gates.references);
  for (const row of blindEvidence?.blindResults ?? []) if (row.executionEvidenceId) usedIds.add(row.executionEvidenceId);
  if (usedIds.size !== executions.size || [...executions.keys()].some((id) => !usedIds.has(id))) throw new Error('RECEIPT_DANGLING_EXECUTION_EVIDENCE');

  const assessed = deriveP05Outcome({publicOutcomes: gates.outcomes, blindOutcome, candidateHash: pub.candidateHash,
    freezeValid, holdoutValid, lifecycleValid: lifecycleValid(lifecycleEvents, publicPass), modelEvidenceValid: true, backend,
    executionEvidenceValid: executions.size > 0, sandboxBlockerValid, receiptDurable: true});
  if (pub.blindResult !== assessed.blindOutcome || pub.jobStatus !== assessed.candidateResult.jobStatus ||
      pub.decision !== assessed.candidateResult.decision || canonical(pub.reasonCodes) !== canonical(assessed.candidateResult.reasonCodes) ||
      pub.experimentIntegrity !== assessed.experimentIntegrity || pub.executionBackend !== assessed.executionBackend ||
      pub.milestone !== assessed.milestone || pub.candidateAccepted !== assessed.candidateAccepted ||
      canonical(pub.candidateResult) !== canonical(assessed.candidateResult) || priv.candidateAccepted !== assessed.candidateAccepted) {
    throw new Error('RECEIPT_RESULT_SEMANTICS_INVALID');
  }
}

export function verifyV5Receipt(repositoryRoot: string, runId: string, publicReceiptSha256: string, source?: ImplementationSource) {
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('RECEIPT_RUN_ID_INVALID');
  if (!HASH.test(publicReceiptSha256)) throw new Error('PUBLIC_RECEIPT_HASH_INVALID');
  const root = path.resolve(repositoryRoot, '.agent-runs', 'p05-s', runId);
  if (lstatSync(root).isSymbolicLink()) throw new Error('RECEIPT_ROOT_INVALID');
  const publicBytes = readObject(root, {id: `public/objects/${publicReceiptSha256}.bin`, sha256: publicReceiptSha256}, 'public');
  const pub = parseJson(publicBytes, 'PUBLIC_RECEIPT_JSON_INVALID') as Record<string, any>;
  if (pub.version !== 5 || pub.runId !== runId || !pub.privateReceipt || !Array.isArray(pub.publicObjects)) throw new Error('PUBLIC_RECEIPT_SCHEMA_INVALID');
  assertAllowedFields(pub, PUBLIC_FIELDS);
  validateObjectRefs(pub.publicObjects, 'PUBLIC');
  validateObjectRefs([pub.privateReceipt], 'PRIVATE');
  if (pub.privateReceipt.role !== 'private-receipt') throw new Error('PRIVATE_RECEIPT_REFERENCE_INVALID');
  for (const item of pub.publicObjects as EvidenceObject[]) readObject(root, item, 'public');
  const privateBytes = readObject(root, pub.privateReceipt, 'private');
  const priv = parseJson(privateBytes, 'PRIVATE_RECEIPT_JSON_INVALID') as Record<string, any>;
  if (priv.version !== 5 || priv.runId !== runId || !Array.isArray(priv.objects)) throw new Error('PRIVATE_RECEIPT_SCHEMA_INVALID');
  assertAllowedFields(priv, PRIVATE_FIELDS);
  validateObjectRefs(priv.objects, 'PRIVATE');
  for (const item of priv.objects as EvidenceObject[]) readObject(root, item, 'private');
  const expectedBinding = assertP05ImplementationBinding(source ?? gitImplementationSource(repositoryRoot), 'hackathon/nebius-nvidia-cat-r5-20261006');
  assertV5Semantics(root, pub, priv, expectedBinding);
  return {runId, publicReceiptSha256, privateReceiptSha256: pub.privateReceipt.sha256, objectCount: pub.publicObjects.length + priv.objects.length, verified: true as const};
}
