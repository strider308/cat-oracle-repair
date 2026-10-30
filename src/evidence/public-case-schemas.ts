import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {canonical} from '../oracle/canonical.ts';
import {verifyP04Receipt} from '../verifier/receipt-v3.ts';

export const P04_CONTROL_SOURCE = 'evidence/sealed/835caa06-aba0-413b-a6b2-df2efb47cb96.json';
export const P04_CONTROL_SOURCE_SHA256 = '6a47c6a59d6d9f5a403bacb07472c3621885b07d950355b8611b26a1e0be3d58';
export const H0_AUTHORITY_SOURCE = 'docs/HUMAN_APPROVED_CONTRACTS.md';
export const H0_AUTHORITY_SOURCE_SHA256 = '57a33018da0104be002855dc762ce8f4aa1449aaa3468891192010ccee17bc8e';
export const H0_SCENARIO_SOURCE = 'fixtures/public-evidence/h0-1-authority-preflight-001.scenario.json';
export const H0_SCENARIO_SOURCE_SHA256 = '764c2e707d16c6fae848cdaf30907bea0a34ae6c61bb726bc197a7d307743134';

const omittedClasses = ['private-evidence', 'holdout-challenge-content', 'candidate-source', 'model-provenance', 'execution-backend-provenance'] as const;
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const repoPathPattern = /^[A-Za-z0-9._/-]+$/;

export interface PublicExecutedControlV1 {
  schema: 'PublicExecutedControlV1';
  version: 1;
  case: {id: 'p04-good-control-001'; title: string; headline: string};
  evidenceKind: 'VERIFIED_EXECUTED_CONTROL';
  decision: 'ACCEPTED';
  candidateAccepted: true;
  sourceReceipt: {path: typeof P04_CONTROL_SOURCE; fileSha256: typeof P04_CONTROL_SOURCE_SHA256; runId: string; canonicalReceiptHash: string};
  verifierImplementationFileSha256: string;
  lane: {id: 'good'; projectionManifestSha256: string; decision: 'ACCEPTED'};
  results: {public: 'PASS'; sealed: 'PASS'};
  blindChallengeCount: 1;
  sealBeforeExecution: true;
  existingSuite: 'NOT_APPLICABLE';
  historicalRun: boolean;
  aggregateRunDecision: 'REJECTED';
  privacy: {publicSafe: true; omittedClasses: readonly string[]};
}

export interface PublicAuthorityPreflightV1 {
  schema: 'PublicAuthorityPreflightV1';
  version: 1;
  case: {id: 'h0-1-authority-preflight-001'; title: string; headline: string};
  decision: 'HUMAN_REQUIRED';
  candidateAccepted: false;
  completionStatus: 'COMPLETED';
  authorityStatus: 'AMBIGUOUS';
  reason: 'AUTHORITY_AMBIGUOUS';
  execution: 'NOT_RUN';
  hiddenVerification: 'NOT_APPLICABLE';
  historicalRun: false;
  operationalFailure: false;
  modelInference: 'NOT_RUN';
  provenance: {
    authorityDocumentPath: typeof H0_AUTHORITY_SOURCE;
    authorityDocumentSha256: typeof H0_AUTHORITY_SOURCE_SHA256;
    authorityContractId: 'H0-1';
    scenarioDefinitionPath: typeof H0_SCENARIO_SOURCE;
    scenarioDefinitionSha256: string;
  };
  privacy: {publicSafe: true; omittedClasses: readonly string[]};
}

function invalid(schema: string, reason: string): never {
  throw new Error(`${schema}_INVALID:${reason}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value: unknown, keys: string[], name: string): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) invalid(name, 'FIELD_SET');
}

function hash(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !hashPattern.test(value)) invalid(name, 'SHA256');
}

function safePath(value: unknown, expected: string, name: string): asserts value is string {
  if (value !== expected || !repoPathPattern.test(value) || value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.gortex' || part.toLowerCase() === '.agent-runs')) invalid(name, 'PATH');
}

function assertPrivacy(value: unknown, schema: string): asserts value is {publicSafe: true; omittedClasses: readonly string[]} {
  exact(value, ['publicSafe', 'omittedClasses'], `${schema}.privacy`);
  if (value.publicSafe !== true || JSON.stringify(value.omittedClasses) !== JSON.stringify(omittedClasses)) invalid(schema, 'PRIVACY');
}

export function validatePublicExecutedControlV1(value: unknown): asserts value is PublicExecutedControlV1 {
  const schema = 'PublicExecutedControlV1';
  exact(value, ['schema', 'version', 'case', 'evidenceKind', 'decision', 'candidateAccepted', 'sourceReceipt', 'verifierImplementationFileSha256', 'lane', 'results', 'blindChallengeCount', 'sealBeforeExecution', 'existingSuite', 'historicalRun', 'aggregateRunDecision', 'privacy'], schema);
  if (value.schema !== schema || value.version !== 1 || value.evidenceKind !== 'VERIFIED_EXECUTED_CONTROL' || value.decision !== 'ACCEPTED' || value.candidateAccepted !== true || value.existingSuite !== 'NOT_APPLICABLE' || typeof value.historicalRun !== 'boolean' || value.aggregateRunDecision !== 'REJECTED' || value.blindChallengeCount !== 1 || value.sealBeforeExecution !== true) invalid(schema, 'SEMANTICS');
  exact(value.case, ['id', 'title', 'headline'], `${schema}.case`);
  if (value.case.id !== 'p04-good-control-001' || value.case.title !== 'Verified P04 good control lane' || value.case.headline !== 'The verified good control passed public and blinded checks.') invalid(schema, 'CASE');
  exact(value.sourceReceipt, ['path', 'fileSha256', 'runId', 'canonicalReceiptHash'], `${schema}.sourceReceipt`);
  safePath(value.sourceReceipt.path, P04_CONTROL_SOURCE, `${schema}.sourceReceipt.path`);
  if (value.sourceReceipt.fileSha256 !== P04_CONTROL_SOURCE_SHA256 || typeof value.sourceReceipt.runId !== 'string' || !uuidPattern.test(value.sourceReceipt.runId)) invalid(schema, 'SOURCE_BINDING');
  hash(value.sourceReceipt.canonicalReceiptHash, `${schema}.sourceReceipt.canonicalReceiptHash`);
  hash(value.verifierImplementationFileSha256, `${schema}.verifierImplementationFileSha256`);
  exact(value.lane, ['id', 'projectionManifestSha256', 'decision'], `${schema}.lane`);
  if (value.lane.id !== 'good' || value.lane.decision !== 'ACCEPTED') invalid(schema, 'LANE');
  hash(value.lane.projectionManifestSha256, `${schema}.lane.projectionManifestSha256`);
  exact(value.results, ['public', 'sealed'], `${schema}.results`);
  if (value.results.public !== 'PASS' || value.results.sealed !== 'PASS') invalid(schema, 'FAILED_ACCEPTANCE');
  assertPrivacy(value.privacy, schema);
}

export function validatePublicAuthorityPreflightV1(value: unknown): asserts value is PublicAuthorityPreflightV1 {
  const schema = 'PublicAuthorityPreflightV1';
  exact(value, ['schema', 'version', 'case', 'decision', 'candidateAccepted', 'completionStatus', 'authorityStatus', 'reason', 'execution', 'hiddenVerification', 'historicalRun', 'operationalFailure', 'modelInference', 'provenance', 'privacy'], schema);
  if (value.schema !== schema || value.version !== 1 || value.decision !== 'HUMAN_REQUIRED' || value.candidateAccepted !== false || value.completionStatus !== 'COMPLETED' || value.authorityStatus !== 'AMBIGUOUS' || value.reason !== 'AUTHORITY_AMBIGUOUS' || value.execution !== 'NOT_RUN' || value.hiddenVerification !== 'NOT_APPLICABLE' || value.historicalRun !== false || value.operationalFailure !== false || value.modelInference !== 'NOT_RUN') invalid(schema, 'SEMANTICS');
  exact(value.case, ['id', 'title', 'headline'], `${schema}.case`);
  if (value.case.id !== 'h0-1-authority-preflight-001' || value.case.title !== 'H0-1 archived-account authority preflight' || value.case.headline !== 'Automation stopped before execution because authority was ambiguous.') invalid(schema, 'CASE');
  exact(value.provenance, ['authorityDocumentPath', 'authorityDocumentSha256', 'authorityContractId', 'scenarioDefinitionPath', 'scenarioDefinitionSha256'], `${schema}.provenance`);
  safePath(value.provenance.authorityDocumentPath, H0_AUTHORITY_SOURCE, `${schema}.provenance.authorityDocumentPath`);
  safePath(value.provenance.scenarioDefinitionPath, H0_SCENARIO_SOURCE, `${schema}.provenance.scenarioDefinitionPath`);
  if (value.provenance.authorityDocumentSha256 !== H0_AUTHORITY_SOURCE_SHA256 || value.provenance.authorityContractId !== 'H0-1') invalid(schema, 'AUTHORITY_BINDING');
  hash(value.provenance.scenarioDefinitionSha256, `${schema}.provenance.scenarioDefinitionSha256`);
  assertPrivacy(value.privacy, schema);
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]));
}

export function serializePublicExecutedControlV1(value: PublicExecutedControlV1): string {
  validatePublicExecutedControlV1(value);
  return `${JSON.stringify(sortedJson(value), null, 2)}\n`;
}

export function serializePublicAuthorityPreflightV1(value: PublicAuthorityPreflightV1): string {
  validatePublicAuthorityPreflightV1(value);
  return `${JSON.stringify(sortedJson(value), null, 2)}\n`;
}

function readBoundedJson(root: string, relativePath: string, expectedHash: string, reason: string, normalizeLineEndings = false): {bytes: Buffer; value: any} {
  const raw = readFileSync(path.join(root, relativePath));
  const bytes = normalizeLineEndings ? canonicalSourceBytes(raw) : raw;
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error(`${reason}_SOURCE_HASH`);
  return {bytes, value: JSON.parse(bytes.toString('utf8'))};
}

function canonicalSourceBytes(bytes: Buffer): Buffer {
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) throw new Error('SOURCE_LINE_ENDING_INVALID');
  return Buffer.from(normalized, 'utf8');
}

function readFixture(root: string, relativePath: string): Buffer {
  return readFileSync(path.join(root, relativePath));
}

const AUTHORITY_FIXTURE = 'fixtures/public-evidence/h0-1-authority-preflight-001.human-required.json';

export function projectVerifiedGoodControl(root = process.cwd()): PublicExecutedControlV1 {
  if (!existsSync(path.join(root, P04_CONTROL_SOURCE))) throw new Error('P04_CONTROL_VERIFICATION_FAILED');
  const {value: receipt} = readBoundedJson(root, P04_CONTROL_SOURCE, P04_CONTROL_SOURCE_SHA256, 'P04_CONTROL');
  const currentSha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  if (receipt.runId !== path.basename(P04_CONTROL_SOURCE, '.json') || !verifyP04Receipt(receipt, root) ||
      receipt.candidate?.decision !== 'REJECTED' ||
      receipt.publicResults?.good !== 'PASS' || receipt.sealedResults?.good !== 'PASS' || receipt.decisions?.good !== 'ACCEPTED' ||
      receipt.holdoutChallengeCount !== 1 || Date.parse(receipt.sealCreatedAt) > Date.parse(receipt.candidateStartedAt)) throw new Error('P04_CONTROL_VERIFICATION_FAILED');
  const verifierHash = receipt.implementationHashes?.['receipt-verifier'];
  const laneProjectionManifestSha256 = receipt.candidateWorkspaceHashes?.good;
  if (!hashPattern.test(verifierHash ?? '') || !hashPattern.test(laneProjectionManifestSha256 ?? '')) throw new Error('P04_CONTROL_BINDING_MISSING');
  const evidence: PublicExecutedControlV1 = {
    schema: 'PublicExecutedControlV1', version: 1,
    case: {id: 'p04-good-control-001', title: 'Verified P04 good control lane', headline: 'The verified good control passed public and blinded checks.'},
    evidenceKind: 'VERIFIED_EXECUTED_CONTROL', decision: 'ACCEPTED', candidateAccepted: true,
    sourceReceipt: {path: P04_CONTROL_SOURCE, fileSha256: P04_CONTROL_SOURCE_SHA256, runId: receipt.runId, canonicalReceiptHash: receipt.receiptHash},
    verifierImplementationFileSha256: verifierHash,
    lane: {id: 'good', projectionManifestSha256: laneProjectionManifestSha256, decision: 'ACCEPTED'},
    results: {public: 'PASS', sealed: 'PASS'}, blindChallengeCount: receipt.holdoutChallengeCount,
    sealBeforeExecution: true, existingSuite: 'NOT_APPLICABLE', historicalRun: receipt.baseSha !== currentSha, aggregateRunDecision: 'REJECTED',
    privacy: {publicSafe: true, omittedClasses},
  };
  validatePublicExecutedControlV1(evidence);
  return evidence;
}

const H0_SCENARIO = {scenarioId: 'H0-1', caseId: 'h0-1-authority-preflight-001', decision: 'HUMAN_REQUIRED', candidateAccepted: false, completionStatus: 'COMPLETED', authorityStatus: 'AMBIGUOUS', reason: 'AUTHORITY_AMBIGUOUS', execution: 'NOT_RUN', hiddenVerification: 'NOT_APPLICABLE', historicalRun: false, operationalFailure: false, modelInference: 'NOT_RUN'} as const;

export function projectH0AuthorityPreflight(root = process.cwd()): PublicAuthorityPreflightV1 {
  const authorityBytes = canonicalSourceBytes(readFileSync(path.join(root, H0_AUTHORITY_SOURCE)));
  if (createHash('sha256').update(authorityBytes).digest('hex') !== H0_AUTHORITY_SOURCE_SHA256) throw new Error('H0_AUTHORITY_SOURCE_HASH');
  const authorityText = authorityBytes.toString('utf8');
  if (!/^## H0-1 — Archived account reactivation\s*$/m.test(authorityText)) throw new Error('H0_AUTHORITY_CONTRACT_MISSING');
  const {bytes: scenarioBytes, value: scenario} = readBoundedJson(root, H0_SCENARIO_SOURCE, H0_SCENARIO_SOURCE_SHA256, 'H0_SCENARIO', true);
  if (canonical(scenario) !== canonical(H0_SCENARIO)) throw new Error('H0_SCENARIO_CONTRADICTION');
  const evidence: PublicAuthorityPreflightV1 = {
    schema: 'PublicAuthorityPreflightV1', version: 1,
    case: {id: 'h0-1-authority-preflight-001', title: 'H0-1 archived-account authority preflight', headline: 'Automation stopped before execution because authority was ambiguous.'},
    decision: 'HUMAN_REQUIRED', candidateAccepted: false, completionStatus: 'COMPLETED', authorityStatus: 'AMBIGUOUS', reason: 'AUTHORITY_AMBIGUOUS',
    execution: 'NOT_RUN', hiddenVerification: 'NOT_APPLICABLE', historicalRun: false, operationalFailure: false, modelInference: 'NOT_RUN',
    provenance: {authorityDocumentPath: H0_AUTHORITY_SOURCE, authorityDocumentSha256: H0_AUTHORITY_SOURCE_SHA256, authorityContractId: 'H0-1', scenarioDefinitionPath: H0_SCENARIO_SOURCE, scenarioDefinitionSha256: createHash('sha256').update(scenarioBytes).digest('hex')},
    privacy: {publicSafe: true, omittedClasses},
  };
  validatePublicAuthorityPreflightV1(evidence);
  if (serializePublicAuthorityPreflightV1(evidence) !== canonicalSourceBytes(readFixture(root, AUTHORITY_FIXTURE)).toString('utf8')) throw new Error('H0_AUTHORITY_FIXTURE_MISMATCH');
  return evidence;
}
