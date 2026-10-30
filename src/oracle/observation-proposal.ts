import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {canonical} from './canonical.ts';
import {H0_2_OBSERVATION_SCENARIOS, H0_2_ORDINARY_SUITE, runOracleObservationScenario, verifyOracleRepairReceipt} from './execute-fixtures.ts';

const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const isRecord = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export const ORACLE_OBSERVATION_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
export const ORACLE_OBSERVATION_MAX_TOKENS = 192;
export const ORACLE_OBSERVATION_MAX_RESPONSE_BYTES = 1024;
export function createOracleObservationPreparationManifest(proposal: ReturnType<typeof createOracleObservationRequest>, body: string, endpoint: string) {
  const bodySha256 = sha(body);
  return {
    schema: 'CatOracleObservationPreparationV1', status: 'PREPARED_NO_PROVIDER_REQUEST',
    operationReference: `cat-oracle-observation-${bodySha256.slice(0, 24)}`,
    sourceCommit: proposal.value.source.commit,
    fixtureSourceTreeSha256: proposal.value.source.fixtureSourceTreeSha256,
    proposalTreeSha256: proposal.value.source.proposalTreeSha256,
    endpoint, model: proposal.value.model,
    requestPolicy: {method: 'POST', timeoutMs: 30000, maxAttempts: 1, retryAfterAmbiguousOutcome: false},
    package: {bytes: Buffer.byteLength(proposal.packageBytes), sha256: proposal.packageSha256},
    prompt: {bytes: Buffer.byteLength(proposal.prompt), sha256: proposal.promptSha256},
    httpBody: {bytes: Buffer.byteLength(body), sha256: bodySha256},
    limits: {maxOutputTokens: proposal.value.modelLimits.maxTokens, maxModelContentResponseBytes: proposal.value.modelLimits.maxResponseBytes,
      maxHttpEnvelopeBytes: 1024 * 1024},
    priceUsdPerMillionTokens: {input: 0.30, output: 0.90},
    estimatedSingleRequestUsd: Number(((Buffer.byteLength(body) * 0.30 + proposal.value.modelLimits.maxTokens * 0.90) / 1_000_000).toFixed(8)),
    estimateBasis: 'Approximate text-size proxy treating each HTTP-body byte as one input token; it is not a guaranteed upper bound. Actual tokenization and account billing may differ.',
    authorization: 'NOT AUTHORIZED; no credentials read and no network request issued',
    pricing: 'Estimate uses previously recorded public rates; exact current model-specific account pricing was not reverified because the 2026-10-29 read-only GET failed DNS ENOTFOUND. Recheck live pricing and bind an owner-approved exposure before execution.',
    executionBoundary: 'The production inference guard remains fail-closed. This artifact is a separate, local request preparation only.',
  };
}
export const ORACLE_OBSERVATION_IMPLEMENTATION_FILES = [
  'package.json', 'scripts/cat-prepare-oracle-observation-proposal.ts', 'src/oracle/canonical.ts', 'src/oracle/gap-solver.ts',
  'src/oracle/execute-fixtures.ts', 'src/oracle/observation-proposal.ts', 'src/runtime/nebius.ts',
  'scripts/oracle-gap-fixture-child.mjs', 'docs/HUMAN_APPROVED_CONTRACTS.md',
  'fixtures/oracle-gap-repair/auth-good.mjs', 'fixtures/oracle-gap-repair/auth-equivalent.mjs',
  'fixtures/oracle-gap-repair/auth-survivor.mjs', 'fixtures/oracle-gap-repair/auth-rejected.mjs',
].sort();
const H0_2_CLAUSE = 'A user may export only records belonging to the tenant they are currently accessing and for which they are authorized. Visibility, ownership by the same user, organization membership, sharing status, or elevated tenant-level role must not allow records from another tenant to appear in the export unless an explicit cross-tenant permission exists.';

export const ORACLE_OBSERVATION_RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['scenarioId', 'field', 'expected', 'rationale'],
  properties: {
    scenarioId: {type: 'string', enum: H0_2_OBSERVATION_SCENARIOS.map(({id}) => id)},
    field: {type: 'string', enum: ['response']},
    expected: {type: 'string', enum: ['ALLOW', 'DENY']},
    rationale: {type: 'string', maxLength: 160},
  },
} as const;

export function createOracleObservationRequest(input: {receipt: Record<string, any>; contractText: string; root: string}) {
  const {receipt, root} = input;
  if (!verifyOracleRepairReceipt(receipt, root) || receipt.caseId !== 'h0-2-export' || receipt.specificationStatus !== 'HUMAN_APPROVED_SOURCE' ||
      receipt.clauseId !== 'H0-2' || !Array.isArray(receipt.ordinarySuite)) throw new Error('ORACLE_OBSERVATION_SOURCE_BINDING_INVALID');
  if (sha(input.contractText) !== receipt.contractSha256 || !input.contractText.includes('## H0-2 — Tenant-scoped export') || !input.contractText.includes(H0_2_CLAUSE)) {
    throw new Error('ORACLE_OBSERVATION_CONTRACT_INVALID');
  }
  const files = ORACLE_OBSERVATION_IMPLEMENTATION_FILES.map((file) => ({path: file, sha256: sha(readFileSync(path.join(root, file)))}));
  const value = {
    schema: 'CatOracleObservationRequestV2', version: 2, purpose: 'oracle_observation', model: ORACLE_OBSERVATION_MODEL,
    source: {commit: receipt.sourceCommit, fixtureSourceTreeSha256: receipt.sourceTreeSha256, proposalTreeSha256: sha(canonical(files)),
      suiteSha256: sha(canonical(receipt.ordinarySuite)), scenarioCatalogSha256: sha(canonical(H0_2_OBSERVATION_SCENARIOS))},
    authority: {status: 'HUMAN_APPROVED_SOURCE', clauseId: 'H0-2', contractSha256: receipt.contractSha256, clause: H0_2_CLAUSE},
    originalAcceptanceSuite: receipt.ordinarySuite,
    observableFields: [{field: 'response', description: 'The result returned by this export attempt.'}],
    scenarioOptions: H0_2_OBSERVATION_SCENARIOS.map(({id, description, input}) => ({id, description, input})),
    outputTask: 'Choose one listed scenario that can improve the H0-2 acceptance oracle. Propose its expected response and briefly explain why this observation matters. You cannot add inputs, fields, tests, code, paths, or contract requirements.',
    modelLimits: {maxTokens: ORACLE_OBSERVATION_MAX_TOKENS, maxResponseBytes: ORACLE_OBSERVATION_MAX_RESPONSE_BYTES},
  };
  const packageBytes = canonical(value);
  const prompt = canonical({task: value.outputTask, constraints: 'Return exactly one schema-conforming proposal. Select a scenario ID from scenarioOptions and a field from observableFields; infer the expected response only from the approved contract; do not claim to know implementation outcomes.',
    sourceBinding: {commit: value.source.commit, fixtureSourceTreeSha256: value.source.fixtureSourceTreeSha256, proposalTreeSha256: value.source.proposalTreeSha256,
      suiteSha256: value.source.suiteSha256, scenarioCatalogSha256: value.source.scenarioCatalogSha256},
    authority: value.authority, originalAcceptanceSuite: value.originalAcceptanceSuite, observableFields: value.observableFields, scenarioOptions: value.scenarioOptions});
  return {value, packageBytes, packageSha256: sha(packageBytes), prompt, promptSha256: sha(prompt), root};
}

export function validateOracleObservationResponse(raw: string, request: ReturnType<typeof createOracleObservationRequest>) {
  const value = request.value;
  const currentFiles = ORACLE_OBSERVATION_IMPLEMENTATION_FILES.map((file) => ({path: file, sha256: sha(readFileSync(path.join(request.root, file)))}));
  if (sha(canonical(value)) !== request.packageSha256 || value.schema !== 'CatOracleObservationRequestV2' || value.purpose !== 'oracle_observation' ||
      sha(request.prompt) !== request.promptSha256 || value.model !== ORACLE_OBSERVATION_MODEL || value.authority?.clause !== H0_2_CLAUSE ||
      execFileSync('git', ['-C', request.root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim() !== value.source?.commit ||
      !/^[a-f0-9]{64}$/.test(value.source?.fixtureSourceTreeSha256) || value.source?.proposalTreeSha256 !== sha(canonical(currentFiles)) ||
      value.source.suiteSha256 !== sha(canonical(value.originalAcceptanceSuite)) || value.source.scenarioCatalogSha256 !== sha(canonical(H0_2_OBSERVATION_SCENARIOS)) ||
      canonical(value.originalAcceptanceSuite) !== canonical(H0_2_ORDINARY_SUITE) || canonical(value.scenarioOptions) !== canonical(H0_2_OBSERVATION_SCENARIOS) ||
      canonical(value.observableFields) !== canonical([{field: 'response', description: 'The result returned by this export attempt.'}]) ||
      value.authority?.status !== 'HUMAN_APPROVED_SOURCE' || value.authority?.clauseId !== 'H0-2' ||
      value.authority?.contractSha256 !== sha(readFileSync(path.join(request.root, 'docs/HUMAN_APPROVED_CONTRACTS.md'))) ||
      !Array.isArray(value.originalAcceptanceSuite) || value.originalAcceptanceSuite.length !== 2) {
    throw new Error('ORACLE_OBSERVATION_REQUEST_BINDING_INVALID');
  }
  if (Buffer.byteLength(raw, 'utf8') > ORACLE_OBSERVATION_MAX_RESPONSE_BYTES) throw new Error('ORACLE_OBSERVATION_RESPONSE_TOO_LARGE');
  let responseValue: unknown;
  try { responseValue = JSON.parse(raw); } catch { throw new Error('ORACLE_OBSERVATION_RESPONSE_JSON_INVALID'); }
  if (!isRecord(responseValue) || Object.keys(responseValue).sort().join('|') !== 'expected|field|rationale|scenarioId' ||
      !H0_2_OBSERVATION_SCENARIOS.some(({id}) => id === responseValue.scenarioId) || responseValue.field !== 'response' ||
      !['ALLOW', 'DENY'].includes(responseValue.expected) || typeof responseValue.rationale !== 'string' || responseValue.rationale.length > 160 ||
      /[\u0000-\u001f\u007f]/.test(responseValue.rationale)) throw new Error('ORACLE_OBSERVATION_RESPONSE_SCHEMA_INVALID');
  const proposal = {scenarioId: responseValue.scenarioId, field: responseValue.field, expected: responseValue.expected, rationale: responseValue.rationale};
  return {proposal, responseSha256: sha(raw), proposalSha256: sha(canonical(proposal))};
}

function assessAuthority(scenarioId: string, expected: unknown) {
  const scenario = H0_2_OBSERVATION_SCENARIOS.find(({id}) => id === scenarioId);
  if (!scenario) throw new Error('ORACLE_OBSERVATION_SCENARIO_UNSUPPORTED');
  const {subject, record} = scenario.input;
  if (subject.tenant !== record.tenant && expected !== 'DENY' || !subject.canExport && expected !== 'DENY') {
    return {authorityAssessment: 'CONTRACT_INCONSISTENT', expectedByContract: 'DENY', reasonCode: 'CONTRACT_INCONSISTENT'};
  }
  if (subject.tenant !== record.tenant || !subject.canExport) {
    return {authorityAssessment: 'CONTRACT_SUPPORTED', expectedByContract: 'DENY', reasonCode: null};
  }
  if (expected === 'ALLOW') {
    return {authorityAssessment: 'EXISTING_SUITE_EXPECTATION_ONLY', expectedByContract: null, reasonCode: 'INSUFFICIENT_SPECIFICATION_AUTHORITY'};
  }
  return {authorityAssessment: 'INSUFFICIENT_SPECIFICATION_AUTHORITY', expectedByContract: null, reasonCode: 'INSUFFICIENT_SPECIFICATION_AUTHORITY'};
}

export function evaluateOracleObservationProposal(input: {receipt: Record<string, any>; proposal: {scenarioId: string; field: string; expected: unknown}; root: string}) {
  const receipt = input.receipt;
  if (!verifyOracleRepairReceipt(receipt, input.root) || receipt.caseId !== 'h0-2-export' || !H0_2_OBSERVATION_SCENARIOS.some(({id}) => id === input.proposal.scenarioId) || input.proposal.field !== 'response') {
    return {status: 'UNRESOLVED', reason: 'Source-bound H0-2 fixture evidence or a supported scenario is unavailable.'};
  }
  const execution = runOracleObservationScenario(receipt, input.proposal.scenarioId, input.root);
  const authority = assessAuthority(input.proposal.scenarioId, input.proposal.expected);
  const controls = execution.controls.map(({id, role, candidateSha256, ordinarySuiteOutcome, observation, observationSha256}) => {
    if (observationSha256 !== sha(canonical(observation))) throw new Error('ORACLE_OBSERVATION_CONTROL_BINDING_INVALID');
    const proposedAssertionOutcome = Object.hasOwn(observation, input.proposal.field)
      ? canonical(observation[input.proposal.field]) === canonical(input.proposal.expected) ? 'PASS' : 'FAIL' : 'UNOBSERVABLE';
    return {id, role, candidateSha256, ordinarySuiteOutcome, proposedAssertionOutcome,
      combinedFinalAcceptance: ordinarySuiteOutcome === 'PASS' && proposedAssertionOutcome === 'PASS' ? 'ACCEPT' : 'REJECT'};
  });
  const positives = controls.filter(({role}) => role === 'POSITIVE');
  const negatives = controls.filter(({role}) => role !== 'POSITIVE');
  const survivor = controls.find(({role}) => role === 'SURVIVOR');
  const positiveControlPreservation = positives.every(({combinedFinalAcceptance}) => combinedFinalAcceptance === 'ACCEPT');
  const survivorDetection = survivor?.combinedFinalAcceptance === 'REJECT';
  const falseAcceptance = negatives.filter(({combinedFinalAcceptance}) => combinedFinalAcceptance === 'ACCEPT').length;
  const falseRejection = positives.filter(({combinedFinalAcceptance}) => combinedFinalAcceptance === 'REJECT').length;
  const alreadyRejectedPreserved = controls.filter(({role}) => role === 'ALREADY_REJECTED').every(({combinedFinalAcceptance}) => combinedFinalAcceptance === 'REJECT');
  const reasonCodes = [authority.reasonCode, !positiveControlPreservation ? 'POSITIVE_CONTROL_REJECTION' : null,
    !survivorDetection ? 'SURVIVOR_NOT_DETECTED' : null, !alreadyRejectedPreserved || falseAcceptance > 0 ? 'NEGATIVE_CONTROL_ACCEPTED' : null].filter(Boolean);
  const status = authority.authorityAssessment === 'CONTRACT_INCONSISTENT' ? 'UNSUPPORTED'
    : authority.authorityAssessment !== 'CONTRACT_SUPPORTED' ? 'UNRESOLVED'
      : positiveControlPreservation && survivorDetection && alreadyRejectedPreserved && falseAcceptance === 0 && falseRejection === 0 ? 'PROPOSAL_VERIFIED_CASE_SCOPE' : 'UNRESOLVED';
  return {status, scenarioId: input.proposal.scenarioId, ...authority, originalSuiteOutcomes: controls.map(({id, ordinarySuiteOutcome}) => ({id, outcome: ordinarySuiteOutcome})),
    reasonCodes: reasonCodes.length ? reasonCodes : status === 'UNRESOLVED' ? ['INSUFFICIENT_SPECIFICATION_AUTHORITY'] : [],
    controls, metrics: {falseAcceptance, falseRejection, positiveControlPreservation, survivorDetection, alreadyRejectedPreserved}, executionEvidence: execution,
    sourceTreeSha256: execution.sourceTreeSha256, limitation: execution.limitation};
}
