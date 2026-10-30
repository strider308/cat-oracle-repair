import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  validatePublicAuthorityPreflightV1, serializePublicAuthorityPreflightV1, validatePublicExecutedControlV1, serializePublicExecutedControlV1,
  projectVerifiedGoodControl,
  type PublicAuthorityPreflightV1, type PublicExecutedControlV1,
} from './public-case-schemas.ts';
import {validatePublicEvidenceV1, serializePublicEvidenceV1, type PublicEvidenceV1} from './public-evidence-v1.ts';

export const DEFAULT_PUBLIC_CASE_ID = 'node-cache-ttl-zero-001';
export const REJECTED_FIXTURE_PATH = 'fixtures/public-evidence/node-cache-ttl-zero-001.rejected.json';
const REJECTED_FIXTURE_SHA256 = 'dd9539a1663d29b01abfc0edf5f8bddf202b7830d05730a1db946e259269ce6a';

function canonicalFixtureText(bytes: Buffer): string {
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const withoutWindowsNewlines = text.replace(/\r\n/g, '');
  if (withoutWindowsNewlines.includes('\r')) throw new Error('PUBLIC_CASE_LINE_ENDING_INVALID');
  return text.replace(/\r\n/g, '\n');
}

export type PublicDecisionCase =
  | {kind: 'historical-execution'; evidence: PublicEvidenceV1}
  | {kind: 'verified-control'; evidence: PublicExecutedControlV1}
  | {kind: 'authority-preflight'; evidence: PublicAuthorityPreflightV1};

export interface NormalizedPublicCase {
  id: string;
  title: string;
  headline: string;
  kind: PublicDecisionCase['kind'];
  decision: 'ACCEPTED' | 'REJECTED' | 'HUMAN_REQUIRED' | 'INCONCLUSIVE';
  candidateAccepted: boolean;
  explanation: string;
  status: {label: string; value: string}[];
  behavior?: {expected: string; observed: string};
  gates: {label: string; result: string; detail: string}[];
  provenance: {label: string; value: string; mono?: boolean}[];
  omittedClasses: string[];
}

type CaseDefinition = {
  id: string;
  kind: PublicDecisionCase['kind'];
  fixedPath: string;
  validate(value: unknown): void;
  serialize(value: any): string;
};

export const PUBLIC_CASE_REGISTRY: readonly CaseDefinition[] = [
  {id: DEFAULT_PUBLIC_CASE_ID, kind: 'historical-execution', fixedPath: REJECTED_FIXTURE_PATH, validate: validatePublicEvidenceV1, serialize: serializePublicEvidenceV1},
  {id: 'p04-good-control-001', kind: 'verified-control', fixedPath: 'fixtures/public-evidence/p04-good-control-001.accepted.json', validate: validatePublicExecutedControlV1, serialize: serializePublicExecutedControlV1},
  {id: 'h0-1-authority-preflight-001', kind: 'authority-preflight', fixedPath: 'fixtures/public-evidence/h0-1-authority-preflight-001.human-required.json', validate: validatePublicAuthorityPreflightV1, serialize: serializePublicAuthorityPreflightV1},
];

export function publicCaseDefinition(id: string): CaseDefinition {
  const definition = PUBLIC_CASE_REGISTRY.find((item) => item.id === id);
  if (!definition) throw new Error('PUBLIC_CASE_UNKNOWN');
  return definition;
}

export function loadPublicFixtureCase(id = DEFAULT_PUBLIC_CASE_ID, root = process.cwd()): {decisionCase: PublicDecisionCase; normalized: NormalizedPublicCase; publicJson: string; id: string} {
  const definition = publicCaseDefinition(id);
  const bytes = readFileSync(path.join(root, definition.fixedPath));
  const text = canonicalFixtureText(bytes);
  if (definition.id === DEFAULT_PUBLIC_CASE_ID && createSha256(Buffer.from(text, 'utf8')) !== REJECTED_FIXTURE_SHA256) throw new Error('PUBLIC_CASE_FIXTURE_INTEGRITY');
  const evidence = JSON.parse(text) as PublicEvidenceV1 | PublicExecutedControlV1 | PublicAuthorityPreflightV1;
  definition.validate(evidence);
  const publicJson = definition.serialize(evidence);
  if (publicJson !== text) throw new Error('PUBLIC_CASE_FIXTURE_NOT_CANONICAL');
  const decisionCase = {kind: definition.kind, evidence} as PublicDecisionCase;
  return {decisionCase, normalized: normalizePublicDecisionCase(decisionCase), publicJson, id: definition.id};
}

export function loadPublicDecisionCase(id = DEFAULT_PUBLIC_CASE_ID, root = process.cwd()): {decisionCase: PublicDecisionCase; normalized: NormalizedPublicCase; publicJson: string; id: string} {
  const loaded = loadPublicFixtureCase(id, root);
  if (id === 'p04-good-control-001' && serializePublicExecutedControlV1(projectVerifiedGoodControl(root)) !== loaded.publicJson) throw new Error('P04_CONTROL_FIXTURE_MISMATCH');
  return loaded;
}

function createSha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizePublicDecisionCase(value: PublicDecisionCase): NormalizedPublicCase {
  if (value.kind === 'historical-execution') {
    const evidence = value.evidence;
    validatePublicEvidenceV1(evidence);
    const decision = evidence.decision.decision ?? 'INCONCLUSIVE';
    const explanation = decision === 'ACCEPTED'
      ? 'Candidate was consistent with the approved interpretation across evaluated public and blinded cases.'
      : decision === 'REJECTED'
        ? 'Evaluated evidence found a contradiction.'
        : decision === 'HUMAN_REQUIRED' ? 'Authority was not clear enough for an honest automated decision.' : evidence.decision.summary;
    return {
      id: evidence.case.id, title: evidence.case.title, headline: evidence.case.headline, kind: value.kind, decision,
      candidateAccepted: evidence.decision.candidateAccepted, explanation,
      status: [{label: 'Existing suite', value: evidence.ci.existingSuite}, {label: 'Execution', value: evidence.execution.backend}, {label: 'Hidden verification', value: evidence.hiddenVerification.state}],
      behavior: {expected: evidence.authority.expectedBehavior, observed: evidence.authority.observedBehavior},
      gates: evidence.gates.map((gate) => ({label: gate.label, result: gate.result, detail: gate.failureKind === 'SEMANTIC' ? 'Evaluated evidence found a behavioral contradiction.' : gate.failureKind.replaceAll('_', ' ')})),
      provenance: [
        ...(evidence.inference.provider ? [{label: 'AI inference', value: evidence.inference.provider}] : []),
        ...(evidence.inference.model ? [{label: 'Model', value: evidence.inference.model, mono: true}] : []),
        {label: 'Candidate execution', value: evidence.execution.backend},
        ...(evidence.provenance.sourceImplementationSha ? [{label: 'Source implementation SHA', value: evidence.provenance.sourceImplementationSha, mono: true}] : []),
        ...(evidence.provenance.verifierImplementationSha ? [{label: 'Verifier implementation SHA', value: evidence.provenance.verifierImplementationSha, mono: true}] : []),
      ],
      omittedClasses: [...evidence.privacy.omittedClasses],
    };
  }
  if (value.kind === 'verified-control') {
    const evidence = value.evidence;
    validatePublicExecutedControlV1(evidence);
    return {
      id: evidence.case.id, title: evidence.case.title, headline: evidence.case.headline, kind: value.kind, decision: evidence.decision,
      candidateAccepted: evidence.candidateAccepted,
      explanation: 'Candidate was consistent with the approved interpretation across evaluated public and blinded cases.',
      status: [{label: 'Existing suite', value: evidence.existingSuite}, {label: 'Public verification', value: evidence.results.public}, {label: 'Blinded verification', value: evidence.results.sealed}],
      gates: [{label: 'Public verification', result: evidence.results.public, detail: 'Verified public control lane'}, {label: 'Blinded verification', result: evidence.results.sealed, detail: 'One sealed challenge; challenge content omitted'}],
      provenance: [
        {label: 'Source receipt path', value: evidence.sourceReceipt.path},
        {label: 'Source receipt file SHA256', value: evidence.sourceReceipt.fileSha256, mono: true},
        {label: 'Canonical receipt hash', value: evidence.sourceReceipt.canonicalReceiptHash, mono: true},
        {label: 'Source run ID', value: evidence.sourceReceipt.runId, mono: true},
        {label: 'Verifier implementation SHA256', value: evidence.verifierImplementationFileSha256, mono: true},
        {label: 'Good lane projection manifest SHA256', value: evidence.lane.projectionManifestSha256, mono: true},
      ],
      omittedClasses: [...evidence.privacy.omittedClasses],
    };
  }
  const evidence = value.evidence;
  validatePublicAuthorityPreflightV1(evidence);
  return {
    id: evidence.case.id, title: evidence.case.title, headline: evidence.case.headline, kind: value.kind, decision: evidence.decision,
    candidateAccepted: evidence.candidateAccepted, explanation: 'Authority was not clear enough for an honest automated decision.',
    status: [{label: 'Automation', value: 'STOPPED'}, {label: 'Execution', value: evidence.execution}, {label: 'Hidden verification', value: evidence.hiddenVerification}, {label: 'Authority', value: evidence.authorityStatus}],
    gates: [{label: 'Authority preflight', result: 'HUMAN_REQUIRED', detail: evidence.reason}],
    provenance: [
      {label: 'Authority document path', value: evidence.provenance.authorityDocumentPath},
      {label: 'Authority document SHA256', value: evidence.provenance.authorityDocumentSha256, mono: true},
      {label: 'Authority contract', value: evidence.provenance.authorityContractId},
      {label: 'Scenario definition path', value: evidence.provenance.scenarioDefinitionPath},
      {label: 'Scenario definition SHA256', value: evidence.provenance.scenarioDefinitionSha256, mono: true},
    ],
    omittedClasses: [...evidence.privacy.omittedClasses],
  };
}
