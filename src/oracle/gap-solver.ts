import {createHash} from 'node:crypto';

type JsonScalar = string | number | boolean | null;
type Role = 'POSITIVE' | 'SURVIVOR' | 'ALREADY_REJECTED';
export type OracleGapInput = {
  authority: {status: 'SOURCE_SUPPORTED_CONTRACT'; clauseId: string; contractSha256: string};
  scenarioSha256: string;
  inputSha256: string;
  currentOracle: {observes: string[]; expected: Record<string, JsonScalar>};
  candidateFields: {field: string; expected: JsonScalar; meaning: string}[];
  controls: {id: string; role: Role; currentOutcome: 'PASS' | 'FAIL'; candidateSha256: string; suiteObservation: Record<string, JsonScalar>; observation: Record<string, JsonScalar>}[];
};

const MAX_BYTES = 16_384;
const MAX_FIELDS = 12;
const MAX_CONTROLS = 8;
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key) && !forbiddenKeys.has(key)) && keys.every((key) => Object.hasOwn(value, key));
const validName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) && !forbiddenKeys.has(value);
const validScalar = (value: unknown): value is JsonScalar => value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= 512 || typeof value === 'number' && Number.isFinite(value);

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function canonicalInput(input: OracleGapInput): string {
  return stable({
    authority: input.authority,
    scenarioSha256: input.scenarioSha256,
    inputSha256: input.inputSha256,
    currentOracle: {observes: input.currentOracle.observes.slice().sort(), expected: input.currentOracle.expected},
    candidateFields: input.candidateFields.slice().sort((a, b) => compare(a.field, b.field)),
    controls: input.controls.slice().sort((a, b) => compare(a.id, b.id)),
  });
}

function validInput(value: unknown): value is OracleGapInput {
  if (!isRecord(value) || !onlyKeys(value, ['authority', 'scenarioSha256', 'inputSha256', 'currentOracle', 'candidateFields', 'controls']) || Buffer.byteLength(stable(value)) > MAX_BYTES) return false;
  const {authority, scenarioSha256, inputSha256, currentOracle, candidateFields, controls} = value;
  if (!isRecord(authority) || !onlyKeys(authority, ['status', 'clauseId', 'contractSha256']) || authority.status !== 'SOURCE_SUPPORTED_CONTRACT' || !validName(authority.clauseId) || typeof authority.contractSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(authority.contractSha256)) return false;
  if (typeof scenarioSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(scenarioSha256) || typeof inputSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(inputSha256)) return false;
  if (!isRecord(currentOracle) || !onlyKeys(currentOracle, ['observes', 'expected']) || !Array.isArray(currentOracle.observes) || !isRecord(currentOracle.expected) || !candidateFields || !Array.isArray(candidateFields) || !Array.isArray(controls)) return false;
  if (Object.keys(currentOracle.expected).some((key) => forbiddenKeys.has(key))) return false;
  if (candidateFields.length === 0 || candidateFields.length > MAX_FIELDS || controls.length < 4 || controls.length > MAX_CONTROLS) return false;
  if (currentOracle.observes.some((key: unknown) => !validName(key)) || new Set(currentOracle.observes).size !== currentOracle.observes.length) return false;
  if (!Object.keys(currentOracle.expected).every((key) => validName(key) && validScalar(currentOracle.expected[key])) || currentOracle.observes.some((key: string) => !Object.hasOwn(currentOracle.expected, key))) return false;
  const fields = new Set<string>();
  for (const candidate of candidateFields) {
    if (!isRecord(candidate) || !onlyKeys(candidate, ['field', 'expected', 'meaning']) || !validName(candidate.field) || typeof candidate.meaning !== 'string' || candidate.meaning.length < 1 || candidate.meaning.length > 256 || !validScalar(candidate.expected) || fields.has(candidate.field) || currentOracle.observes.includes(candidate.field)) return false;
    fields.add(candidate.field);
  }
  const ids = new Set<string>();
  for (const control of controls) {
    if (!isRecord(control) || !onlyKeys(control, ['id', 'role', 'currentOutcome', 'candidateSha256', 'suiteObservation', 'observation']) || !validName(control.id) || ids.has(control.id) || !['POSITIVE', 'SURVIVOR', 'ALREADY_REJECTED'].includes(String(control.role)) || !['PASS', 'FAIL'].includes(String(control.currentOutcome)) || typeof control.candidateSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(control.candidateSha256) || !isRecord(control.suiteObservation) || !isRecord(control.observation)) return false;
    ids.add(control.id);
    if ([control.suiteObservation, control.observation].some((observation) => Object.keys(observation).some((key) => !validName(key) || !validScalar(observation[key])))) return false;
  }
  return controls.filter((control: any) => control.role === 'POSITIVE').length >= 2 && controls.some((control: any) => control.role === 'SURVIVOR' && control.currentOutcome === 'PASS') && controls.some((control: any) => control.role === 'ALREADY_REJECTED' && control.currentOutcome === 'FAIL');
}

function outcome(control: OracleGapInput['controls'][number], fields: string[], expected: Record<string, JsonScalar>): 'PASS' | 'FAIL' | 'UNOBSERVABLE' {
  for (const field of fields) {
    if (!Object.hasOwn(control.observation, field)) return 'UNOBSERVABLE';
    if (stable(control.observation[field]) !== stable(expected[field])) return 'FAIL';
  }
  return 'PASS';
}

export function solveOracleGap(input: unknown): Record<string, unknown> {
  try { if (!validInput(input)) return {status: 'UNSUPPORTED', reason: 'Input is malformed or exceeds bounded analysis limits.'}; }
  catch { return {status: 'UNSUPPORTED', reason: 'Input is malformed or exceeds bounded analysis limits.'}; }
  const inputSha256 = createHash('sha256').update(canonicalInput(input)).digest('hex');
  const positives = input.controls.filter((control) => control.role === 'POSITIVE');
  const survivors = input.controls.filter((control) => control.role === 'SURVIVOR');
  const candidates = input.candidateFields.slice().sort((a, b) => compare(a.field, b.field));
  let subsetsEvaluated = 0;
  if (input.controls.some((control) => candidates.some((candidate) => !Object.hasOwn(control.observation, candidate.field)))) {
    return {status: 'UNRESOLVED', inputSha256, reason: 'A control is missing a candidate observation.'};
  }
  if (input.controls.some((control) => outcome({...control, observation: control.suiteObservation}, input.currentOracle.observes, input.currentOracle.expected) !== control.currentOutcome)) {
    return {status: 'UNRESOLVED', inputSha256, reason: 'Recorded current-oracle outcomes contradict the supplied observations.'};
  }
  for (const candidate of candidates) {
    if (positives.some((control) => !Object.hasOwn(control.observation, candidate.field) || stable(control.observation[candidate.field]) !== stable(candidate.expected))) {
      return {status: 'UNRESOLVED', inputSha256, reason: 'A positive control is missing or contradicts a contract-bound expected observation.'};
    }
  }
  const solutions: string[][] = [];
  for (let size = 1; size <= candidates.length && solutions.length === 0; size++) {
    const choose = (start: number, picked: string[]) => {
      if (picked.length === size) {
        subsetsEvaluated++;
        const expected = Object.fromEntries(candidates.filter((item) => picked.includes(item.field)).map((item) => [item.field, item.expected]));
        if (positives.every((control) => outcome(control, picked, expected) === 'PASS') &&
            survivors.every((control) => outcome(control, picked, expected) === 'FAIL') &&
            input.controls.filter((control) => control.role === 'ALREADY_REJECTED').every((control) => control.currentOutcome === 'FAIL' || outcome(control, picked, expected) === 'FAIL')) solutions.push(picked.slice());
        return;
      }
      for (let index = start; index <= candidates.length - (size - picked.length); index++) choose(index + 1, [...picked, candidates[index].field]);
    };
    choose(0, []);
  }
  const searchBound = {candidateObservations: candidates.length, maximumCandidateObservations: MAX_FIELDS, subsetsEvaluated};
  if (!solutions.length) return {status: 'NO_SOLUTION', inputSha256, searchBound, reason: 'No bounded observation set distinguishes every survivor while preserving positive and existing negative controls.'};
  return {
    status: 'PROPOSAL',
    inputSha256,
    scenarioSha256: input.scenarioSha256,
    comparisonInputSha256: input.inputSha256,
    controls: input.controls.slice().sort((a, b) => compare(a.id, b.id)).map(({id, role, currentOutcome, candidateSha256, observation}) => {
      const proposedAssertionOutcome = outcome({id, role, currentOutcome, candidateSha256, observation, suiteObservation: {}}, solutions[0], Object.fromEntries(solutions[0].map((field) => [field, candidates.find((candidate) => candidate.field === field)!.expected]))) === 'PASS' ? 'PASS' : 'FAIL';
      return {id, role, originalSuiteOutcome: currentOutcome, candidateSha256, counterfactualObservation: observation,
        proposedAssertionOutcome, combinedFinalAcceptance: currentOutcome === 'PASS' && proposedAssertionOutcome === 'PASS' ? 'ACCEPT' : 'REJECT'};
    }),
    authority: {clauseId: input.authority.clauseId, contractSha256: input.authority.contractSha256, status: 'CALLER_DECLARED_NOT_INDEPENDENTLY_VERIFIED'},
    minimumAdditions: solutions.map((fields) => ({
      fields,
      expected: Object.fromEntries(fields.map((field) => [field, candidates.find((item) => item.field === field)!.expected])),
    })),
    searchBound,
    positiveControlsPreserved: true,
    alreadyRejectedControlsRemainRejected: true,
    scope: 'PROPOSED_OBSERVATIONS_REQUIRE_SPECIFICATION_REVIEW',
    limitation: 'Authority, scenario/input hashes, and candidate hashes are caller-declared and are not independently verified here. Recorded observations are not fresh isolated execution or proof of general oracle strength.',
  };
}
