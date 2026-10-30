import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runOracleRepairDemonstrations} from '../src/oracle/execute-fixtures.ts';
import {createOracleObservationPreparationManifest, createOracleObservationRequest, evaluateOracleObservationProposal, ORACLE_OBSERVATION_RESPONSE_SCHEMA, validateOracleObservationResponse} from '../src/oracle/observation-proposal.ts';
import {buildTokenFactoryObservationBody, TOKEN_FACTORY_BASE_URL} from '../src/runtime/nebius.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
if (execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=no'], {encoding: 'utf8'}).trim()) {
  throw new Error('ORACLE_OBSERVATION_SOURCE_MUST_BE_COMMITTED');
}
const receipts = runOracleRepairDemonstrations(root);
const receipt = receipts.find((item) => item.caseId === 'h0-2-export');
if (!receipt) throw new Error('H0_2_EXECUTION_RECEIPT_MISSING');
if (receipt.trackedWorkingTreeChanges || execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim() !== receipt.sourceCommit) {
  throw new Error('ORACLE_OBSERVATION_SOURCE_COMMIT_MISMATCH');
}
const proposal = createOracleObservationRequest({receipt, root, contractText: readFileSync(path.join(root, receipt.contractPath), 'utf8')});
const body = buildTokenFactoryObservationBody(proposal.value.model, proposal.prompt, ORACLE_OBSERVATION_RESPONSE_SCHEMA);
const output = path.join(root, '.verification-runs', 'oracle-observation-proposal');
mkdirSync(output, {recursive: true});
writeFileSync(path.join(output, 'request-package.json'), proposal.packageBytes);
writeFileSync(path.join(output, 'http-body.json'), body);
const simulations = [
  {case: 'successful', scenarioId: 'cross-tenant-authorized', expected: 'DENY'},
  {case: 'irrelevant', scenarioId: 'same-tenant-authorized', expected: 'ALLOW'},
  {case: 'contradictory', scenarioId: 'cross-tenant-authorized', expected: 'ALLOW'},
  {case: 'overstrict', scenarioId: 'same-tenant-authorized', expected: 'DENY'},
].map(({case: name, scenarioId, expected}) => {
  const rawResponse = JSON.stringify({scenarioId, field: 'response', expected, rationale: 'Simulated test response; no provider execution occurred.'});
  const parsed = validateOracleObservationResponse(rawResponse, proposal);
  return {case: name, responseSource: 'SIMULATED_TEST_FIXTURE_NOT_PROVIDER', rawResponse, rawResponseSha256: hash(rawResponse),
    normalizedProposalSha256: parsed.proposalSha256, result: evaluateOracleObservationProposal({receipt, proposal: parsed.proposal, root})};
});
writeFileSync(path.join(output, 'simulated-results.json'), `${JSON.stringify({schema: 'CatOracleObservationSimulationV1', sourceCommit: receipt.sourceCommit,
  requestPackageSha256: proposal.packageSha256, httpBodySha256: hash(body), simulations}, null, 2)}\n`);
const manifest = createOracleObservationPreparationManifest(proposal, body, `${TOKEN_FACTORY_BASE_URL}chat/completions`);
writeFileSync(path.join(output, 'preparation.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest)}\n`);
