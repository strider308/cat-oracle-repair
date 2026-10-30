import {createHash} from 'node:crypto';

export type PublicDecision = 'ACCEPTED' | 'REJECTED' | 'HUMAN_REQUIRED' | null;
export type PublicJobStatus = 'RUNNING' | 'COMPLETED' | 'INCONCLUSIVE' | 'CANCELLED';
export type PublicGateResult = 'PASS' | 'FAIL' | 'ERROR' | 'NOT_RUN' | 'NOT_APPLICABLE';
export type PublicFailureKind = 'NONE' | 'SEMANTIC' | 'OPERATIONAL' | 'SKIPPED' | 'NOT_APPLICABLE';
export type HiddenVerificationState = 'NOT_CREATED' | 'CREATED_NOT_RUN' | 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'NOT_APPLICABLE';
export type EvidenceVerification = 'VERIFIED' | 'DERIVED_VERIFIED' | 'UNVERIFIED' | 'INCOMPLETE';

export interface PublicEvidenceV1 {
  version: 1;
  case: {id: string; title: string; headline: string; category: 'CACHE_SEMANTICS' | 'AUTHORIZATION' | 'TENANT_ISOLATION' | 'ENTITLEMENTS' | 'BILLING' | 'API_COMPATIBILITY' | 'OTHER'; synthetic: boolean};
  decision: {jobStatus: PublicJobStatus; decision: PublicDecision; candidateAccepted: boolean; reasonCodes: string[]; summary: string};
  ci: {existingSuite: PublicGateResult};
  intervention: {triggered: boolean; reason: string; counterfactualSummary: string};
  authority: {expectedBehavior: string; observedBehavior: string; authorityStatus: 'CONFIRMED' | 'CONTRADICTED' | 'AMBIGUOUS' | 'UNKNOWN'};
  gates: {id: string; label: string; result: PublicGateResult; failureKind: PublicFailureKind; reasonCode: string | null}[];
  candidate: {changedPaths: string[]; patchSha256: string | null; candidateHash: string | null; frozen: boolean; frozenCandidateHash: string | null};
  hiddenVerification: {state: HiddenVerificationState; challengeCount: number; blindResult: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'NOT_RUN'; explanation: 'CANDIDATE_REJECTED_BEFORE_HOLDOUT' | 'BLIND_VERIFICATION_COMPLETED' | 'BLIND_VERIFICATION_INCONCLUSIVE' | 'NOT_APPLICABLE'};
  inference: {provider: string | null; model: string | null; requestId: string | null; operationId: string | null; finishReason: string | null; networkAttempts: number; proven: boolean};
  execution: {backend: 'LOCAL_DOCKER_FALLBACK' | 'NEBIUS_SANDBOX' | 'OTHER' | 'NOT_RUN'; sandboxStatus: 'AVAILABLE' | 'CLIENT_UNAVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE' | 'UNKNOWN'; providerClaim: string};
  provenance: {historicalRunId: string; historicalRunManifestSha256: string; sourceImplementationSha: string; verifierImplementationSha: string | null; originalReceiptStatus: 'VERIFIED' | 'MALFORMED_RECOVERED_DERIVATIVE' | 'UNVERIFIED'; derivedReceiptVerified: boolean; publicReceiptSha256: string};
  integrity: {evidenceState: EvidenceVerification; experimentIntegrity: 'COMPLETE' | 'INCOMPLETE'; verification: EvidenceVerification};
  privacy: {publicSafe: true; omittedClasses: readonly string[]};
}

export interface RejectedHeroSourceV1 {
  candidateHash: string;
  operationId: string | null;
  executionBackend: 'LOCAL_DOCKER_FALLBACK';
  sandboxStatus: 'CLIENT_UNAVAILABLE';
}

export const PUBLIC_EVIDENCE_OMITTED_CLASSES = [
  'credentials',
  'raw-model-io',
  'private-holdout',
  'private-evidence-bodies',
  'private-receipts',
  'candidate-source',
  'local-environment',
  'docker-host-paths',
  'secret-file-paths',
] as const;

const DECISIONS = new Set(['ACCEPTED', 'REJECTED', 'HUMAN_REQUIRED']);
const JOB_STATUSES = new Set(['RUNNING', 'COMPLETED', 'INCONCLUSIVE', 'CANCELLED']);
const GATE_RESULTS = new Set(['PASS', 'FAIL', 'ERROR', 'NOT_RUN', 'NOT_APPLICABLE']);
const FAILURE_KINDS = new Set(['NONE', 'SEMANTIC', 'OPERATIONAL', 'SKIPPED', 'NOT_APPLICABLE']);
const HIDDEN_STATES = new Set(['NOT_CREATED', 'CREATED_NOT_RUN', 'PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE']);
const VERIFICATION_STATES = new Set(['VERIFIED', 'DERIVED_VERIFIED', 'UNVERIFIED', 'INCOMPLETE']);
const SAFE_COPY = /(?:[a-z]:\\|\\\\|\/home\/|\/Users\/|\.gortex(?:\/|\\)|\.agent-runs(?:\/|\\)|private\/objects|bearer\s+[a-z0-9._~+/-]+|authorization\s*[:=]|(?:raw\s*)?(?:api[_ -]?key|prompt|model response|reasoning)|(?:sealed|private)\s+holdout)/i;

function invalid(reason: string): never {
  throw new Error(`PUBLIC_EVIDENCE_V1_INVALID:${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: unknown, expected: string[], path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) invalid(`${path}:OBJECT_REQUIRED`);
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) invalid(`${path}:FIELD_SET`);
}

function safeCopy(value: unknown, path: string, maxLength = 500): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value) || SAFE_COPY.test(value)) {
    invalid(`${path}:UNSAFE_TEXT`);
  }
}

function enumValue(value: unknown, values: Set<string>, path: string): asserts value is string {
  if (typeof value !== 'string' || !values.has(value)) invalid(`${path}:ENUM`);
}

function hash256(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(`${path}:SHA256`);
}

function objectId(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) invalid(`${path}:OBJECT_ID`);
}

function uuid(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) invalid(`${path}:UUID`);
}

function stringList(value: unknown, path: string, pattern?: RegExp): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 200 || (pattern && !pattern.test(item)))) {
    invalid(`${path}:STRING_LIST`);
  }
  if (new Set(value).size !== value.length) invalid(`${path}:DUPLICATE_VALUE`);
}

function normalizedRepoPath(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240 || value.includes('\\') || value.startsWith('/') ||
      !/^[A-Za-z0-9._/-]+$/.test(value)) invalid(`${path}:PATH`);
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part.toLowerCase() === '.gortex' || part.toLowerCase() === '.agent-runs' ||
      /^(?:secret|secrets|private|credentials?|keys?|\.aws|\.ssh|\.gnupg)$/i.test(part) ||
      /^(?:\.env(?:\..*)?|\.envrc|\.netrc|\.npmrc|\.pypirc|id_(?:rsa|ed25519)|credentials(?:\..*)?)$/i.test(part) && part.toLowerCase() !== '.env.example' ||
      /(?:api[_-]?key|secret|credential|access[_-]?token)/i.test(part))) {
    invalid(`${path}:PATH`);
  }
}

function assertGate(gate: unknown, index: number): asserts gate is PublicEvidenceV1['gates'][number] {
  const path = `gates[${index}]`;
  exactKeys(gate, ['id', 'label', 'result', 'failureKind', 'reasonCode'], path);
  if (typeof gate.id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(gate.id)) invalid(`${path}.id:ID`);
  safeCopy(gate.label, `${path}.label`, 100);
  enumValue(gate.result, GATE_RESULTS, `${path}.result`);
  enumValue(gate.failureKind, FAILURE_KINDS, `${path}.failureKind`);
  if (gate.reasonCode !== null && (typeof gate.reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{1,99}$/.test(gate.reasonCode))) invalid(`${path}.reasonCode:CODE`);
  if (gate.result === 'PASS' && (gate.failureKind !== 'NONE' || gate.reasonCode !== null)) invalid(`${path}:PASS_SHAPE`);
  if (gate.result === 'FAIL' && (!['SEMANTIC', 'OPERATIONAL'].includes(String(gate.failureKind)) || gate.reasonCode === null)) invalid(`${path}:FAIL_SHAPE`);
  if (gate.result === 'ERROR' && (gate.failureKind !== 'OPERATIONAL' || gate.reasonCode === null)) invalid(`${path}:ERROR_SHAPE`);
  if (gate.result === 'NOT_RUN' && gate.failureKind !== 'SKIPPED') invalid(`${path}:NOT_RUN_SHAPE`);
  if (gate.result === 'NOT_APPLICABLE' && gate.failureKind !== 'NOT_APPLICABLE') invalid(`${path}:NOT_APPLICABLE_SHAPE`);
}

export function validatePublicEvidenceV1(value: unknown): asserts value is PublicEvidenceV1 {
  exactKeys(value, ['version', 'case', 'decision', 'ci', 'intervention', 'authority', 'gates', 'candidate', 'hiddenVerification', 'inference', 'execution', 'provenance', 'integrity', 'privacy'], 'evidence');
  if (value.version !== 1) invalid('version:VERSION');

  exactKeys(value.case, ['id', 'title', 'headline', 'category', 'synthetic'], 'case');
  if (typeof value.case.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,100}$/.test(value.case.id)) invalid('case.id:ID');
  safeCopy(value.case.title, 'case.title', 140);
  safeCopy(value.case.headline, 'case.headline', 180);
  enumValue(value.case.category, new Set(['CACHE_SEMANTICS', 'AUTHORIZATION', 'TENANT_ISOLATION', 'ENTITLEMENTS', 'BILLING', 'API_COMPATIBILITY', 'OTHER']), 'case.category');
  if (typeof value.case.synthetic !== 'boolean' || (value.case.synthetic && !value.case.title.includes('SYNTHETIC_TEST_ONLY'))) invalid('case.synthetic:MARKER');

  exactKeys(value.decision, ['jobStatus', 'decision', 'candidateAccepted', 'reasonCodes', 'summary'], 'decision');
  enumValue(value.decision.jobStatus, JOB_STATUSES, 'decision.jobStatus');
  if (value.decision.decision !== null) enumValue(value.decision.decision, DECISIONS, 'decision.decision');
  if (typeof value.decision.candidateAccepted !== 'boolean') invalid('decision.candidateAccepted:BOOLEAN');
  stringList(value.decision.reasonCodes, 'decision.reasonCodes', /^[A-Z][A-Z0-9_]{1,99}$/);
  safeCopy(value.decision.summary, 'decision.summary', 300);
  if (value.decision.candidateAccepted !== (value.decision.decision === 'ACCEPTED')) invalid('decision:ACCEPTED_BINDING');
  if (value.decision.decision === 'REJECTED' && value.decision.reasonCodes.length === 0) invalid('decision:REJECTED_REASON');
  if (value.decision.jobStatus === 'COMPLETED' && value.decision.decision === null) invalid('decision:COMPLETED_NULL');
  if ((value.decision.jobStatus === 'INCONCLUSIVE' || value.decision.jobStatus === 'CANCELLED') && value.decision.decision !== null) invalid('decision:INCONCLUSIVE_STATUS');
  if (value.decision.jobStatus === 'RUNNING' && value.decision.decision !== null) invalid('decision:RUNNING_STATUS');

  exactKeys(value.ci, ['existingSuite'], 'ci');
  enumValue(value.ci.existingSuite, GATE_RESULTS, 'ci.existingSuite');

  exactKeys(value.intervention, ['triggered', 'reason', 'counterfactualSummary'], 'intervention');
  if (typeof value.intervention.triggered !== 'boolean') invalid('intervention.triggered:BOOLEAN');
  safeCopy(value.intervention.reason, 'intervention.reason', 300);
  safeCopy(value.intervention.counterfactualSummary, 'intervention.counterfactualSummary', 300);

  exactKeys(value.authority, ['expectedBehavior', 'observedBehavior', 'authorityStatus'], 'authority');
  safeCopy(value.authority.expectedBehavior, 'authority.expectedBehavior', 360);
  safeCopy(value.authority.observedBehavior, 'authority.observedBehavior', 360);
  enumValue(value.authority.authorityStatus, new Set(['CONFIRMED', 'CONTRADICTED', 'AMBIGUOUS', 'UNKNOWN']), 'authority.authorityStatus');
  if (value.decision.decision === 'HUMAN_REQUIRED' && value.authority.authorityStatus !== 'AMBIGUOUS') invalid('decision:HUMAN_AUTHORITY');

  if (!Array.isArray(value.gates) || value.gates.length === 0 || value.gates.length > 32) invalid('gates:ARRAY');
  value.gates.forEach(assertGate);
  if (new Set(value.gates.map((gate) => gate.id)).size !== value.gates.length) invalid('gates:DUPLICATE_ID');
  if (value.decision.decision === 'ACCEPTED' && value.gates.some((gate) => gate.result !== 'PASS' && gate.result !== 'NOT_APPLICABLE')) invalid('decision:ACCEPTED_WITH_FAILED_GATE');
  if (value.gates.some((gate) => gate.result === 'ERROR') && (value.decision.decision !== null || value.decision.jobStatus !== 'INCONCLUSIVE')) invalid('decision:OPERATIONAL_ERROR');

  exactKeys(value.candidate, ['changedPaths', 'patchSha256', 'candidateHash', 'frozen', 'frozenCandidateHash'], 'candidate');
  if (!Array.isArray(value.candidate.changedPaths)) invalid('candidate.changedPaths:ARRAY');
  value.candidate.changedPaths.forEach((candidatePath, index) => normalizedRepoPath(candidatePath, `candidate.changedPaths[${index}]`));
  if (new Set(value.candidate.changedPaths).size !== value.candidate.changedPaths.length) invalid('candidate.changedPaths:DUPLICATE');
  for (const [name, hash] of [['patchSha256', value.candidate.patchSha256], ['candidateHash', value.candidate.candidateHash], ['frozenCandidateHash', value.candidate.frozenCandidateHash]] as const) {
    if (hash !== null) hash256(hash, `candidate.${name}`);
  }
  if (typeof value.candidate.frozen !== 'boolean' || value.candidate.frozen !== (value.candidate.frozenCandidateHash !== null)) invalid('candidate:FROZEN_BINDING');
  if (value.candidate.frozen && value.candidate.candidateHash !== value.candidate.frozenCandidateHash) invalid('candidate:FROZEN_HASH_BINDING');

  exactKeys(value.hiddenVerification, ['state', 'challengeCount', 'blindResult', 'explanation'], 'hiddenVerification');
  enumValue(value.hiddenVerification.state, HIDDEN_STATES, 'hiddenVerification.state');
  if (!Number.isSafeInteger(value.hiddenVerification.challengeCount) || value.hiddenVerification.challengeCount < 0) invalid('hiddenVerification.challengeCount:INTEGER');
  enumValue(value.hiddenVerification.blindResult, new Set(['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_RUN']), 'hiddenVerification.blindResult');
  enumValue(value.hiddenVerification.explanation, new Set(['CANDIDATE_REJECTED_BEFORE_HOLDOUT', 'BLIND_VERIFICATION_COMPLETED', 'BLIND_VERIFICATION_INCONCLUSIVE', 'NOT_APPLICABLE']), 'hiddenVerification.explanation');
  if (value.hiddenVerification.state === 'NOT_CREATED' && (value.candidate.frozen || value.hiddenVerification.challengeCount !== 0 || value.hiddenVerification.blindResult !== 'NOT_RUN')) invalid('hiddenVerification:NOT_CREATED_BINDING');
  if (value.hiddenVerification.state === 'CREATED_NOT_RUN' && (!value.candidate.frozen || value.hiddenVerification.challengeCount === 0 || value.hiddenVerification.blindResult !== 'NOT_RUN')) invalid('hiddenVerification:CREATED_NOT_RUN_BINDING');
  if (value.hiddenVerification.state === 'PASS' && (!value.candidate.frozen || value.hiddenVerification.challengeCount === 0 || value.hiddenVerification.blindResult !== 'PASS')) invalid('hiddenVerification:PASS_BINDING');
  if (value.hiddenVerification.state === 'FAIL' && (!value.candidate.frozen || value.hiddenVerification.challengeCount === 0 || value.hiddenVerification.blindResult !== 'FAIL')) invalid('hiddenVerification:FAIL_BINDING');
  if (value.hiddenVerification.state === 'INCONCLUSIVE' && (!value.candidate.frozen || value.hiddenVerification.challengeCount === 0 || value.hiddenVerification.blindResult !== 'INCONCLUSIVE')) invalid('hiddenVerification:INCONCLUSIVE_BINDING');
  if (value.hiddenVerification.state === 'NOT_APPLICABLE' && (value.hiddenVerification.challengeCount !== 0 || value.hiddenVerification.blindResult !== 'NOT_RUN')) invalid('hiddenVerification:NOT_APPLICABLE_BINDING');
  if (value.hiddenVerification.explanation === 'CANDIDATE_REJECTED_BEFORE_HOLDOUT' && value.hiddenVerification.state !== 'NOT_CREATED') invalid('hiddenVerification:EXPLANATION_BINDING');
  if (value.hiddenVerification.explanation === 'BLIND_VERIFICATION_COMPLETED' && !['PASS', 'FAIL'].includes(value.hiddenVerification.state)) invalid('hiddenVerification:EXPLANATION_BINDING');
  if (value.hiddenVerification.explanation === 'BLIND_VERIFICATION_INCONCLUSIVE' && value.hiddenVerification.state !== 'INCONCLUSIVE') invalid('hiddenVerification:EXPLANATION_BINDING');
  if (value.hiddenVerification.explanation === 'NOT_APPLICABLE' && value.hiddenVerification.state !== 'NOT_APPLICABLE') invalid('hiddenVerification:EXPLANATION_BINDING');
  if (value.decision.decision === 'ACCEPTED' && value.hiddenVerification.state !== 'PASS') invalid('decision:ACCEPTED_WITHOUT_HIDDEN_PASS');

  exactKeys(value.inference, ['provider', 'model', 'requestId', 'operationId', 'finishReason', 'networkAttempts', 'proven'], 'inference');
  for (const name of ['provider', 'model', 'requestId', 'operationId', 'finishReason'] as const) {
    const item = value.inference[name];
    if (item !== null) safeCopy(item, `inference.${name}`, 180);
  }
  if ((value.inference.provider === null) !== (value.inference.model === null)) invalid('inference:PROVIDER_MODEL_PAIR');
  if (value.inference.model?.toLowerCase().startsWith('nvidia/') && value.inference.provider?.toLowerCase() !== 'nebius') invalid('inference:PROVIDER_MODEL_CONTRADICTION');
  if (!Number.isSafeInteger(value.inference.networkAttempts) || value.inference.networkAttempts < 0 || typeof value.inference.proven !== 'boolean') invalid('inference:ATTEMPTS_OR_PROOF');
  if (value.inference.proven && (value.inference.provider === null || value.inference.model === null || value.inference.requestId === null || value.inference.networkAttempts < 1)) invalid('inference:PROVENANCE_REQUIRED');
  if (value.inference.model === null && (value.inference.requestId !== null || value.inference.operationId !== null || value.inference.finishReason !== null || value.inference.networkAttempts !== 0 || value.inference.proven)) invalid('inference:NOT_RUN_PROVENANCE');

  exactKeys(value.execution, ['backend', 'sandboxStatus', 'providerClaim'], 'execution');
  enumValue(value.execution.backend, new Set(['LOCAL_DOCKER_FALLBACK', 'NEBIUS_SANDBOX', 'OTHER', 'NOT_RUN']), 'execution.backend');
  enumValue(value.execution.sandboxStatus, new Set(['AVAILABLE', 'CLIENT_UNAVAILABLE', 'UNAVAILABLE', 'NOT_APPLICABLE', 'UNKNOWN']), 'execution.sandboxStatus');
  safeCopy(value.execution.providerClaim, 'execution.providerClaim', 300);
  const executionClaim = value.execution.providerClaim.toLowerCase();
  if (value.execution.backend === 'LOCAL_DOCKER_FALLBACK' && (!executionClaim.includes('candidate validation ran in isolated local docker') || executionClaim.includes('nebius sandbox'))) invalid('execution:PROVIDER_CLAIM_CONTRADICTION');
  if (value.execution.backend === 'NEBIUS_SANDBOX' && value.execution.sandboxStatus !== 'AVAILABLE') invalid('execution:SANDBOX_STATUS');
  if (value.execution.backend === 'NEBIUS_SANDBOX' && (!executionClaim.includes('candidate validation ran in nebius sandbox') || executionClaim.includes('local docker'))) invalid('execution:PROVIDER_CLAIM_CONTRADICTION');
  if (value.execution.backend === 'OTHER' && /(?:local docker|nebius sandbox)/i.test(value.execution.providerClaim)) invalid('execution:PROVIDER_CLAIM_CONTRADICTION');
  if (value.execution.backend === 'NOT_RUN' && (value.execution.sandboxStatus !== 'NOT_APPLICABLE' || /candidate\s+(?:validation\s+)?(?:ran|was executed|passed|failed)|(?:ran|executed|validated|passed|failed)\s+(?:the\s+)?candidate/i.test(value.execution.providerClaim))) invalid('execution:NOT_RUN_PROVENANCE');

  exactKeys(value.provenance, ['historicalRunId', 'historicalRunManifestSha256', 'sourceImplementationSha', 'verifierImplementationSha', 'originalReceiptStatus', 'derivedReceiptVerified', 'publicReceiptSha256'], 'provenance');
  uuid(value.provenance.historicalRunId, 'provenance.historicalRunId');
  hash256(value.provenance.historicalRunManifestSha256, 'provenance.historicalRunManifestSha256');
  objectId(value.provenance.sourceImplementationSha, 'provenance.sourceImplementationSha');
  if (value.provenance.verifierImplementationSha !== null) objectId(value.provenance.verifierImplementationSha, 'provenance.verifierImplementationSha');
  enumValue(value.provenance.originalReceiptStatus, new Set(['VERIFIED', 'MALFORMED_RECOVERED_DERIVATIVE', 'UNVERIFIED']), 'provenance.originalReceiptStatus');
  if (typeof value.provenance.derivedReceiptVerified !== 'boolean') invalid('provenance.derivedReceiptVerified:BOOLEAN');
  hash256(value.provenance.publicReceiptSha256, 'provenance.publicReceiptSha256');
  if (value.provenance.derivedReceiptVerified && value.provenance.verifierImplementationSha === null) invalid('provenance:VERIFIER_REQUIRED');

  exactKeys(value.integrity, ['evidenceState', 'experimentIntegrity', 'verification'], 'integrity');
  enumValue(value.integrity.evidenceState, VERIFICATION_STATES, 'integrity.evidenceState');
  enumValue(value.integrity.experimentIntegrity, new Set(['COMPLETE', 'INCOMPLETE']), 'integrity.experimentIntegrity');
  enumValue(value.integrity.verification, VERIFICATION_STATES, 'integrity.verification');

  exactKeys(value.privacy, ['publicSafe', 'omittedClasses'], 'privacy');
  if (value.privacy.publicSafe !== true) invalid('privacy:NOT_PUBLIC_SAFE');
  stringList(value.privacy.omittedClasses, 'privacy.omittedClasses');
  if (JSON.stringify(value.privacy.omittedClasses) !== JSON.stringify(PUBLIC_EVIDENCE_OMITTED_CLASSES)) invalid('privacy:OMISSIONS');
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]));
}

export function serializePublicEvidenceV1(value: PublicEvidenceV1): string {
  validatePublicEvidenceV1(value);
  return `${JSON.stringify(sortedJson(value), null, 2)}\n`;
}

export function publicEvidenceSha256(value: PublicEvidenceV1): string {
  return createHash('sha256').update(serializePublicEvidenceV1(value), 'utf8').digest('hex');
}

export function buildRejectedHeroPublicEvidence(source: RejectedHeroSourceV1): PublicEvidenceV1 {
  const evidence: PublicEvidenceV1 = {
    version: 1,
    case: {
      id: 'node-cache-ttl-zero-001',
      title: 'Zero TTL must not delete an existing cache entry.',
      headline: 'Existing tests were green. CAT still rejected the AI patch.',
      category: 'CACHE_SEMANTICS',
      synthetic: false,
    },
    decision: {
      jobStatus: 'COMPLETED',
      decision: 'REJECTED',
      candidateAccepted: false,
      reasonCodes: ['PUBLIC_CONTRACT_FAILURE', 'PUBLIC_ORACLE_V2_FAILURE'],
      summary: 'The existing suite passed, but both public behavior gates found the candidate contradicted the approved zero-TTL behavior.',
    },
    ci: {existingSuite: 'PASS'},
    intervention: {
      triggered: true,
      reason: 'Existing tests did not cover the zero-TTL behavior.',
      counterfactualSummary: 'A zero-TTL update could return success while deleting a key that should remain available.',
    },
    authority: {
      expectedBehavior: 'Calling ttl(key, 0) on an existing cache entry must preserve the entry without an expiry.',
      observedBehavior: 'ttl(key, 0) returned true, but the key was not found and its value was null.',
      authorityStatus: 'CONTRADICTED',
    },
    gates: [
      {id: 'build', label: 'Candidate build', result: 'PASS', failureKind: 'NONE', reasonCode: null},
      {id: 'existing-suite', label: 'Existing test suite', result: 'PASS', failureKind: 'NONE', reasonCode: null},
      {id: 'public-contract', label: 'Public contract', result: 'FAIL', failureKind: 'SEMANTIC', reasonCode: 'PUBLIC_CONTRACT_FAILURE'},
      {id: 'public-oracle-v2', label: 'Calibrated oracle', result: 'FAIL', failureKind: 'SEMANTIC', reasonCode: 'PUBLIC_ORACLE_V2_FAILURE'},
    ],
    candidate: {
      changedPaths: ['_src/lib/node_cache.coffee'],
      patchSha256: 'a68fc186740ce7fee329b8ac8f6e4b2a303ab71c640839d74e6c7522e78b4968',
      candidateHash: source.candidateHash,
      frozen: false,
      frozenCandidateHash: null,
    },
    hiddenVerification: {
      state: 'NOT_CREATED',
      challengeCount: 0,
      blindResult: 'NOT_RUN',
      explanation: 'CANDIDATE_REJECTED_BEFORE_HOLDOUT',
    },
    inference: {
      provider: 'Nebius',
      model: 'nvidia/nemotron-3-super-120b-a12b',
      requestId: 'bd88b15bda53fd59fd337bb6bbde1475',
      operationId: source.operationId,
      finishReason: 'stop',
      networkAttempts: 1,
      proven: true,
    },
    execution: {
      backend: source.executionBackend,
      sandboxStatus: source.sandboxStatus,
      providerClaim: 'Candidate validation ran in isolated local Docker; Nemotron inference ran through Nebius Token Factory.',
    },
    provenance: {
      historicalRunId: '3fed7a48-c95d-42f2-ac83-714c2dbde528',
      historicalRunManifestSha256: 'b6ac5dcb25213c448db56e6c880a5a0fc22966483f19979fb484d03c2071199b',
      sourceImplementationSha: '32e2a0097d4e203b2d18246c27c3fa06188ca9c7',
      verifierImplementationSha: '8da3722dad6852c0652f320da5b101aecdd71e15',
      originalReceiptStatus: 'MALFORMED_RECOVERED_DERIVATIVE',
      derivedReceiptVerified: true,
      publicReceiptSha256: '5afedd83a0bc9371451cd4b87af0db5c6c70c81115d137a8783631c1809076d6',
    },
    integrity: {evidenceState: 'DERIVED_VERIFIED', experimentIntegrity: 'INCOMPLETE', verification: 'DERIVED_VERIFIED'},
    privacy: {publicSafe: true, omittedClasses: [...PUBLIC_EVIDENCE_OMITTED_CLASSES]},
  };
  validatePublicEvidenceV1(evidence);
  return evidence;
}

export function formatPublicEvidenceSummary(value: PublicEvidenceV1): string {
  validatePublicEvidenceV1(value);
  const gate = (id: string) => value.gates.find((item) => item.id === id);
  const contract = gate('public-contract');
  const oracle = gate('public-oracle-v2');
  const hidden = value.hiddenVerification.state === 'NOT_CREATED'
    ? 'NOT CREATED — candidate already rejected'
    : `${value.hiddenVerification.state.replaceAll('_', ' ')} — ${value.hiddenVerification.explanation.replaceAll('_', ' ').toLowerCase()}`;
  const inference = value.inference.provider === null ? ['NOT RUN'] : [
    value.inference.provider.toLowerCase() === 'nebius' ? 'Nebius Token Factory' : value.inference.provider,
    value.inference.model!,
  ];
  return [
    `CAT DECISION: ${value.decision.decision ?? 'INCONCLUSIVE'}`,
    '',
    'Existing CI:',
    value.ci.existingSuite,
    '',
    'Why CAT intervened:',
    value.intervention.reason,
    '',
    'Expected:',
    value.authority.expectedBehavior,
    '',
    'Observed:',
    value.authority.observedBehavior,
    '',
    'CAT evidence:',
    `${(contract?.label ?? 'Public contract').padEnd(20)} ${contract?.result ?? 'NOT_RUN'} — ${(contract?.failureKind ?? 'SKIPPED').toLowerCase()}`,
    `${(oracle?.label ?? 'Calibrated oracle').padEnd(20)} ${oracle?.result ?? 'NOT_RUN'} — ${(oracle?.failureKind ?? 'SKIPPED').toLowerCase()}`,
    `Hidden verification ${hidden}`,
    '',
    'AI inference:',
    ...inference,
    '',
    'Code execution:',
    value.execution.backend === 'LOCAL_DOCKER_FALLBACK' ? 'Isolated local Docker' : value.execution.backend,
    '',
    'Evidence:',
    `${value.integrity.verification === 'DERIVED_VERIFIED' ? 'Derived receipt VERIFIED' : `Receipt ${value.integrity.verification}`}`,
    '',
  ].join('\n');
}
