import {readFileSync} from 'node:fs';
import authGood from '../fixtures/oracle-gap-repair/auth-good.mjs';
import authEquivalent from '../fixtures/oracle-gap-repair/auth-equivalent.mjs';
import authSurvivor from '../fixtures/oracle-gap-repair/auth-survivor.mjs';
import authRejected from '../fixtures/oracle-gap-repair/auth-rejected.mjs';
import idempotencyGood from '../fixtures/oracle-gap-repair/idempotency-good.mjs';
import idempotencyEquivalent from '../fixtures/oracle-gap-repair/idempotency-equivalent.mjs';
import idempotencySurvivor from '../fixtures/oracle-gap-repair/idempotency-survivor.mjs';
import idempotencyRejected from '../fixtures/oracle-gap-repair/idempotency-rejected.mjs';

const policies = {
  'h0-2-export': {good: authGood, equivalent: authEquivalent, survivor: authSurvivor, rejected: authRejected},
  idempotency: {good: idempotencyGood, equivalent: idempotencyEquivalent, survivor: idempotencySurvivor, rejected: idempotencyRejected},
};
const bytes = readFileSync(0);
if (bytes.length > 16_384) process.exit(20);
const input = JSON.parse(bytes.toString('utf8'));
const candidateId = process.argv[2];
const implementation = Object.hasOwn(policies, input.domain) && Object.hasOwn(policies[input.domain], candidateId)
  ? policies[input.domain][candidateId]
  : null;
if (!implementation || !Array.isArray(input.suite) || !input.scenario) process.exit(21);

let suiteResults;
let observation;
if (input.domain === 'h0-2-export') {
  suiteResults = input.suite.map(({subject, record, expected}) => {
    const actual = implementation(subject, record);
    return {actual, expected, pass: actual === expected};
  });
  observation = {response: implementation(input.scenario.subject, input.scenario.record)};
} else {
  suiteResults = input.suite.map(({initialState, operations, expected}) => {
    let state = initialState;
    let response = null;
    for (const operation of operations) {
      const result = implementation(state, operation);
      state = result.state;
      response = result.response;
    }
    return {actual: {balance: state.balance, response}, expected, pass: state.balance === expected.balance && response === expected.response};
  });
  let state = input.scenario.initialState;
  let response = null;
  for (const operation of input.scenario.operations) {
    const result = implementation(state, operation);
    state = result.state;
    response = result.response;
  }
  observation = {balance: state.balance, response};
}
process.stdout.write(`${JSON.stringify({suiteResults, observation})}\n`);
