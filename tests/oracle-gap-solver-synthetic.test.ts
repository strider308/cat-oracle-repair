import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {solveOracleGap, type OracleGapInput} from '../src/oracle/gap-solver.ts';

const contractHash = (contract: string) => createHash('sha256').update(contract).digest('hex');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const approvedContracts = readFileSync(new URL('../docs/HUMAN_APPROVED_CONTRACTS.md', import.meta.url), 'utf8');
const tenantExportContract = 'A user may export only records belonging to the tenant they are currently accessing and for which they are authorized. Visibility, ownership by the same user, organization membership, sharing status, or elevated tenant-level role must not allow records from another tenant to appear in the export unless an explicit cross-tenant permission exists.';
assert.ok(approvedContracts.includes('## H0-2 — Tenant-scoped export') && approvedContracts.includes(tenantExportContract));

type Subject = {tenant: string; canRead: boolean};
type Document = {tenant: string};
type Access = (subject: Subject, document: Document) => 'ALLOW' | 'DENY';
const allowRead: Access = (subject, document) => subject.canRead && subject.tenant === document.tenant ? 'ALLOW' : 'DENY';
const equivalentRead: Access = (subject, document) => document.tenant === subject.tenant && subject.canRead ? 'ALLOW' : 'DENY';
const tenantBypass: Access = (subject) => subject.canRead ? 'ALLOW' : 'DENY';
const denyAll: Access = () => 'DENY';

function accessResult(policy: Access, subject: Subject, document: Document) {
  return {response: policy(subject, document), tenantMatched: subject.tenant === document.tenant};
}

function accessSuite(policy: Access) {
  return accessResult(policy, {tenant: 'north', canRead: true}, {tenant: 'north'}).response === 'ALLOW' &&
    accessResult(policy, {tenant: 'north', canRead: false}, {tenant: 'north'}).response === 'DENY';
}

function accessGap(): OracleGapInput {
  const contract = tenantExportContract;
  const subject = {tenant: 'north', canRead: true};
  const document = {tenant: 'south'};
  const good = accessResult(allowRead, subject, document);
  const equivalent = accessResult(equivalentRead, subject, document);
  const survivor = accessResult(tenantBypass, subject, document);
  const rejected = accessResult(denyAll, subject, document);
  assert.equal(accessSuite(allowRead), true);
  assert.equal(accessSuite(equivalentRead), true);
  assert.equal(accessSuite(tenantBypass), true);
  assert.equal(accessSuite(denyAll), false);
  return {
    authority: {status: 'SOURCE_SUPPORTED_CONTRACT', clauseId: 'H0-2', contractSha256: contractHash(approvedContracts)},
    scenarioSha256: hash(JSON.stringify({name: 'authorization-cross-tenant-read-v1', subject, document})),
    inputSha256: hash(JSON.stringify({subject, document})),
    currentOracle: {observes: ['suiteAccepted'], expected: {suiteAccepted: true}},
    candidateFields: [{field: 'response', expected: 'DENY', meaning: 'A cross-tenant read is denied'}],
    controls: [
      {id: 'auth-good', role: 'POSITIVE', currentOutcome: accessSuite(allowRead) ? 'PASS' : 'FAIL', candidateSha256: hash(allowRead.toString()), suiteObservation: {suiteAccepted: accessSuite(allowRead)}, observation: good},
      {id: 'auth-equivalent', role: 'POSITIVE', currentOutcome: accessSuite(equivalentRead) ? 'PASS' : 'FAIL', candidateSha256: hash(equivalentRead.toString()), suiteObservation: {suiteAccepted: accessSuite(equivalentRead)}, observation: equivalent},
      {id: 'auth-tenant-bypass-survivor', role: 'SURVIVOR', currentOutcome: accessSuite(tenantBypass) ? 'PASS' : 'FAIL', candidateSha256: hash(tenantBypass.toString()), suiteObservation: {suiteAccepted: accessSuite(tenantBypass)}, observation: survivor},
      {id: 'auth-permission-bypass-detected', role: 'ALREADY_REJECTED', currentOutcome: accessSuite(denyAll) ? 'PASS' : 'FAIL', candidateSha256: hash(denyAll.toString()), suiteObservation: {suiteAccepted: accessSuite(denyAll)}, observation: rejected},
    ],
  };
}

type OperationResult = {response: 'OK' | 'INVALID'; balance: number};
type ApplyOperation = (balance: number, seen: Set<string>, operationId: string, amount: number) => OperationResult;
const idempotent: ApplyOperation = (balance, seen, id, amount) => {
  if (amount <= 0) return {response: 'INVALID', balance};
  if (seen.has(id)) return {response: 'OK', balance};
  seen.add(id);
  return {response: 'OK', balance: balance + amount};
};
const equivalentIdempotent: ApplyOperation = (balance, seen, id, amount) => {
  if (amount <= 0) return {response: 'INVALID', balance};
  const duplicate = seen.has(id);
  if (!duplicate) seen.add(id);
  return {response: 'OK', balance: duplicate ? balance : balance + amount};
};
const duplicateApply: ApplyOperation = (balance, _seen, _id, amount) => amount <= 0
  ? {response: 'INVALID', balance}
  : {response: 'OK', balance: balance + amount};
const rejectAll: ApplyOperation = (balance) => ({response: 'INVALID', balance});

function replay(apply: ApplyOperation, amount = 5) {
  const seen = new Set<string>();
  apply(0, seen, 'op-1', amount);
  return apply(amount > 0 ? amount : 0, seen, 'op-1', amount);
}

function operationSuite(apply: ApplyOperation) {
  const seen = new Set<string>();
  const first = apply(0, seen, 'op-1', 5);
  const invalid = apply(0, new Set(), 'op-invalid', 0);
  return first.response === 'OK' && first.balance === 5 && invalid.response === 'INVALID' && invalid.balance === 0;
}

function idempotencyGap(): OracleGapInput {
  const contract = 'Repeating an operation ID must apply its valid amount at most once; non-positive amounts are invalid.';
  const good = replay(idempotent);
  const equivalent = replay(equivalentIdempotent);
  const survivor = replay(duplicateApply);
  const rejected = replay(rejectAll);
  assert.equal(operationSuite(idempotent), true);
  assert.equal(operationSuite(equivalentIdempotent), true);
  assert.equal(operationSuite(duplicateApply), true);
  assert.equal(operationSuite(rejectAll), false);
  return {
    authority: {status: 'SOURCE_SUPPORTED_CONTRACT', clauseId: 'operation-id-once', contractSha256: contractHash(contract)},
    scenarioSha256: hash(JSON.stringify({name: 'duplicate-operation-replay-v1', initialBalance: 0, operationId: 'op-1', amount: 5, replays: 2})),
    inputSha256: hash(JSON.stringify({initialBalance: 0, operationId: 'op-1', amount: 5, replays: 2})),
    currentOracle: {observes: ['suiteAccepted'], expected: {suiteAccepted: true}},
    candidateFields: [{field: 'balance', expected: 5, meaning: 'Balance after replaying the same operation ID'}],
    controls: [
      {id: 'idempotency-good', role: 'POSITIVE', currentOutcome: operationSuite(idempotent) ? 'PASS' : 'FAIL', candidateSha256: hash(idempotent.toString()), suiteObservation: {suiteAccepted: operationSuite(idempotent)}, observation: {response: good.response, balance: good.balance}},
      {id: 'idempotency-equivalent', role: 'POSITIVE', currentOutcome: operationSuite(equivalentIdempotent) ? 'PASS' : 'FAIL', candidateSha256: hash(equivalentIdempotent.toString()), suiteObservation: {suiteAccepted: operationSuite(equivalentIdempotent)}, observation: {response: equivalent.response, balance: equivalent.balance}},
      {id: 'idempotency-duplicate-survivor', role: 'SURVIVOR', currentOutcome: operationSuite(duplicateApply) ? 'PASS' : 'FAIL', candidateSha256: hash(duplicateApply.toString()), suiteObservation: {suiteAccepted: operationSuite(duplicateApply)}, observation: {response: survivor.response, balance: survivor.balance}},
      {id: 'idempotency-invalid-already-detected', role: 'ALREADY_REJECTED', currentOutcome: operationSuite(rejectAll) ? 'PASS' : 'FAIL', candidateSha256: hash(rejectAll.toString()), suiteObservation: {suiteAccepted: operationSuite(rejectAll)}, observation: {response: rejected.response, balance: rejected.balance}},
    ],
  };
}

test('synthetic authorization contract: same cross-tenant input rejects bypass and preserves controls', () => {
  const gap = accessGap();
  const result = solveOracleGap(gap);
  assert.match(gap.scenarioSha256, /^[a-f0-9]{64}$/);
  assert.match(gap.inputSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(gap.controls.map((control) => control.observation.response), ['DENY', 'DENY', 'ALLOW', 'DENY']);
  assert.equal(gap.controls.find((control) => control.id === 'auth-tenant-bypass-survivor')?.currentOutcome, 'PASS');
  assert.deepEqual(result.minimumAdditions, [{fields: ['response'], expected: {response: 'DENY'}}]);
  assert.deepEqual((result.controls as any[]).map(({id, proposedAssertionOutcome, combinedFinalAcceptance}) => [id, proposedAssertionOutcome, combinedFinalAcceptance]), [
    ['auth-equivalent', 'PASS', 'ACCEPT'], ['auth-good', 'PASS', 'ACCEPT'],
    ['auth-permission-bypass-detected', 'PASS', 'REJECT'], ['auth-tenant-bypass-survivor', 'FAIL', 'REJECT'],
  ]);
  assert.equal((result.authority as any).status, 'CALLER_DECLARED_NOT_INDEPENDENTLY_VERIFIED');
  const inputDerived = accessGap();
  inputDerived.candidateFields = [{field: 'tenantMatched', expected: true, meaning: 'Input metadata, not behavior'}];
  assert.equal(solveOracleGap(inputDerived).status, 'UNRESOLVED');
  assert.equal(result.positiveControlsPreserved, true);
  assert.equal(result.alreadyRejectedControlsRemainRejected, true);
  assert.equal(Object.hasOwn(result, 'PROVEN'), false);
});

test('synthetic idempotency contract: replay balance rejects duplicate application and keeps good controls', () => {
  const gap = idempotencyGap();
  const result = solveOracleGap(gap);
  assert.equal(gap.controls.find((control) => control.id === 'idempotency-duplicate-survivor')?.currentOutcome, 'PASS');
  assert.deepEqual(result.minimumAdditions, [{fields: ['balance'], expected: {balance: 5}}]);
  assert.equal(result.positiveControlsPreserved, true);
  assert.equal(result.alreadyRejectedControlsRemainRejected, true);
  assert.equal(Object.hasOwn(result, 'PROVEN'), false);
});
