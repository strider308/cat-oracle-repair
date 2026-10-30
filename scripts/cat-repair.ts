import {createHash, randomUUID} from 'node:crypto';
import {lstatSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical} from '../src/oracle/canonical.ts';
import {evaluateObservation} from '../src/oracle/evaluate.ts';
import {createRepairProjection} from '../src/repair/repair-projection.ts';
import {createRepairRequestPackage, REPAIR_MODIFIABLE_PATH} from '../src/repair/model-response.ts';
import {applyRepairProposal} from '../src/repair/candidate.ts';
import {requestRepairProposal, selectRepairModel} from '../src/repair/provider.ts';
import {createRepairLifecycle, hashRepairTree, type GateEvidence} from '../src/repair/production-lifecycle.ts';
import {createLocalDockerBackend, sandboxAvailability} from '../src/repair/execution.ts';
import {createV5EvidenceStore, verifyV5Receipt, type EvidenceObject} from '../src/repair/receipt-v5.ts';
import {createHoldout, HOLDOUT_GENERATOR_VERSION} from '../src/verifier/holdout-generator.ts';
import {resolveTokenFactoryBaseUrl, listTokenFactoryModels, resolveTokenFactoryFailureCode, selectNvidiaModels, getTokenFactoryFailureDiagnostic} from '../src/runtime/nebius.ts';
import {assertP05ImplementationBinding, gitImplementationSource} from '../src/repair/implementation-binding.ts';
import {deriveBlindSemanticResult, deriveP05Outcome} from '../src/repair/milestone.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASE = path.join(ROOT, 'fixtures/hero/node-cache-ttl-zero-001');
const REGIONAL = 'https://api.tokenfactory.us-central1.nebius.com/v1/';
const CAT_REPAIR_INFERENCE_TIMEOUT_MS = 180_000;
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;

function inventory(root: string) {
  const rows: {path: string; sha256: string; bytes: number}[] = [];
  const visit = (dir: string) => {
    for (const item of readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, item.name);
      const info = lstatSync(file);
      if (item.isSymbolicLink() || info.isSymbolicLink()) throw new Error('CANDIDATE_LINK_REJECTED');
      if (item.isDirectory()) visit(file);
      else if (item.isFile()) { const bytes = readFileSync(file); rows.push({path: path.relative(root, file).split(path.sep).join('/'), sha256: hash(bytes), bytes: bytes.length}); }
      else throw new Error('CANDIDATE_FILE_TYPE_REJECTED');
    }
  };
  visit(root);
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function verifyBuildChanges(before: {path: string; sha256: string; bytes: number}[], after: {path: string; sha256: string; bytes: number}[]) {
  if (before.length !== after.length) throw new Error('BUILD_CHANGED_FILE_SET');
  const generated = new Set(['index.js', 'lib/node_cache.js']);
  for (let index = 0; index < before.length; index++) {
    const old = before[index], current = after[index];
    if (old.path !== current.path) throw new Error('BUILD_CHANGED_FILE_SET');
    if (old.sha256 !== current.sha256 && old.path !== REPAIR_MODIFIABLE_PATH.replace('candidate/', '') && !generated.has(old.path)) throw new Error('BUILD_CHANGED_FIXED_FILE');
  }
}

function gate(gateId: string, candidateHash: string, backend: GateEvidence['backend'], command: string[], runtimeSha256: string,
  outputSha256: string, exitCode: number, semantic: GateEvidence['semantic'], executionEvidenceId: string | null = null,
  observation?: Record<string, unknown>, observationStartedAt?: number, observationFinishedAt?: number): GateEvidence {
  const kind = semantic === 'PASS' ? 'NONE' : semantic === 'FAIL' ? 'SEMANTIC' : semantic === 'ERROR' ? 'OPERATIONAL' : 'SKIPPED';
  const reasons: Record<string, string> = {build: 'BUILD_SEMANTIC_FAILURE', 'existing-suite': 'EXISTING_SUITE_SEMANTIC_FAILURE',
    'public-contract': 'CONTRACT_FAILURE', 'public-oracle-v2': 'ORACLE_V2_FAILURE'};
  const operational: Record<string, string> = {build: 'BUILD_OPERATIONAL_FAILURE', 'existing-suite': 'EXISTING_SUITE_OPERATIONAL_FAILURE',
    'public-contract': 'CONTRACT_OPERATIONAL_FAILURE', 'public-oracle-v2': 'ORACLE_V2_OPERATIONAL_FAILURE'};
  const reasonCode = kind === 'SEMANTIC' ? 'PUBLIC_' + reasons[gateId] : kind === 'OPERATIONAL' ? 'PUBLIC_' + operational[gateId] : null;
  return {gate: gateId, candidateHash, backend, command: command.length ? command : ['not-run'], runtimeSha256, outputSha256, exitCode, semantic,
    failureKind: kind, reasonCode, executionEvidenceId, ...(observation ? {observation, observationStartedAt, observationFinishedAt} : {})};
}

async function main() {
  const renderIndex = process.argv.indexOf('--render-json');
  if (renderIndex >= 0) {
    const runId = process.argv[renderIndex + 1] ?? '';
    if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('RECEIPT_RUN_ID_INVALID');
    const objectDir = path.join(ROOT, '.agent-runs', 'p05-s', runId, 'public', 'objects');
    let receipt: {name: string; value: Record<string, any>} | undefined;
    for (const name of readdirSync(objectDir).filter((item) => /^[a-f0-9]{64}\.bin$/.test(item))) {
      try {
        const value = JSON.parse(readFileSync(path.join(objectDir, name), 'utf8')) as Record<string, any>;
        if (value.version === 5 && value.runId === runId && value.privateReceipt) { receipt = {name, value}; break; }
      } catch { /* Non-receipt public objects are not JSON. */ }
    }
    if (!receipt) throw new Error('PUBLIC_RECEIPT_NOT_FOUND');
    const verified = verifyV5Receipt(ROOT, runId, receipt.name.slice(0, -4));
    process.stdout.write(JSON.stringify({receipt: receipt.value, verification: verified}, null, 2) + '\n');
    return;
  }
  const binding = assertP05ImplementationBinding(gitImplementationSource(ROOT), 'hackathon/nebius-nvidia-cat-r5-20261006');
  process.env.CAT_TOKEN_FACTORY_BASE_URL = REGIONAL;
  const baseUrl = resolveTokenFactoryBaseUrl(process.env.CAT_TOKEN_FACTORY_BASE_URL);
  let apiKey = process.env.NEBIUS_API_KEY ?? '';
  if (!apiKey.trim()) throw new Error('NEBIUS_API_KEY_ABSENT');
  const runId = process.env.CAT_INFERENCE_OPERATION_ID?.trim() || randomUUID();
  if (!/^[a-f0-9-]{36}$/i.test(runId)) throw new Error('INFERENCE_OPERATION_ID_INVALID');
  const store = createV5EvidenceStore(ROOT, runId);
  const publicObjects: EvidenceObject[] = [];
  const privateObjects: EvidenceObject[] = [];
  let projection: ReturnType<typeof createRepairProjection> | undefined;
  let lifecycle: ReturnType<typeof createRepairLifecycle> | undefined;
  let sealedRun: ReturnType<typeof createHoldout> | undefined;
  let publicReceipt: EvidenceObject | undefined;
  let privateReceipt: EvidenceObject | undefined;
  let stage = 'foundation';
  let boundCandidateHash = '0'.repeat(64);
  let result: Record<string, unknown> = {};
  const trackPublic = (role: string, bytes: Buffer | string) => { const item = store.writePublic(role, bytes); publicObjects.push(item); return item; };
  const trackPrivate = (role: string, bytes: Buffer | string) => { const item = store.writePrivate(role, bytes); privateObjects.push(item); return item; };
  const cleanup = () => {
    projection?.cleanup();
    lifecycle?.dispose();
    if (sealedRun) rmSync(path.dirname(sealedRun.artifactPath), {recursive: true, force: true});
  };
  try {
    stage = 'projection';
    projection = createRepairProjection(ROOT);
    const manifest = projection.result.manifest as any;
    const byPath = new Map<string, any>(manifest.files.map((item: any) => [item.path, item]));
    const requestPath = `candidate/${REPAIR_MODIFIABLE_PATH}`;
    const targetRow = byPath.get(requestPath);
    const contractRow = byPath.get('candidate/contract-v3.json');
    const oracleRow = byPath.get('candidate/oracle-v2.json');
    if (!targetRow || !contractRow || !oracleRow || Object.values(projection.result.leakage).some((v) => v !== 'PASS')) throw new Error('REPAIR_PROJECTION_INVALID');
    const candidateRoot = path.join(projection.workspacePath, 'candidate');
    const baseCandidateHash = hashRepairTree(candidateRoot);
    boundCandidateHash = baseCandidateHash;
    const baseCandidateRows = inventory(candidateRoot);
    const publicSummary = {caseId: manifest.caseId, version: manifest.version, manifestHash: projection.result.manifestHash, workspaceHash: manifest.workspaceHash,
      fileCount: manifest.files.length, files: manifest.files.map(({path, role, sha256}: any) => ({path, role, sha256})), leakage: projection.result.leakage};
    trackPublic('projection-summary', canonical(publicSummary));
    privateObjects.push(store.writePrivate('projection-manifest', canonical(manifest)));

    stage = 'discovery';
    const discovery = await listTokenFactoryModels(apiKey, {baseUrl});
    const nvidia = selectNvidiaModels(discovery.models);
    const selected = selectRepairModel(discovery.models);
    const catalog = {models: discovery.models.map(({id, owned_by, name}) => ({id, owned_by: owned_by ?? null, name: name ?? null})), nvidia: nvidia.map(({id, owned_by, name}) => ({id, owned_by: owned_by ?? null, name: name ?? null})), selected: selected.id};
    trackPublic('live-model-catalog', canonical(catalog));
    const sandbox = sandboxAvailability();
    const runner = path.join(ROOT, 'scripts', 'cat-repair-runner.cjs');
    const backend = createLocalDockerBackend({repositoryRoot: ROOT, dependencyRoot: path.join(CASE, 'suite', 'node_modules'), runnerPath: runner});
    privateObjects.push(store.writePrivate('backend-attestation', canonical({backend: backend.backend, image: 'sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32', network: 'none',
      dockerVersion: backend.dockerVersion, dockerHostSha256: hash(backend.host), readOnlyRoot: true, nonRoot: true, capDrop: 'ALL', pidsLimit: 64, memoryLimit: '256m', cpuLimit: 1, dependencyTreeSha256: backend.dependencyManifest.sha256,
      sandboxStatus: sandbox.status, sandboxAuth: sandbox.auth, sandboxProject: sandbox.project, sandboxOperationId: sandbox.operationId,
      sandboxEvidenceSha256: sandbox.safeOutputSha256, sandboxReason: sandbox.reason ?? null,
      sandboxProbe: {version: 1, provider: 'Nebius', status: sandbox.status, auth: sandbox.auth, project: sandbox.project,
        operationId: sandbox.operationId, evidenceSha256: sandbox.safeOutputSha256, reason: sandbox.reason ?? null}})));

    stage = 'request';
    const contextFiles = manifest.files.map((file: any) => {
      const bytes = readFileSync(path.join(projection!.workspacePath, ...file.path.split('/')));
      const content = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
      return {path: file.path, sha256: file.sha256, role: file.role, content};
    });
    const requestPackage = createRepairRequestPackage({caseId: manifest.caseId, model: selected.id, manifestHash: projection.result.manifestHash,
      workspaceHash: manifest.workspaceHash, publicContractHash: contractRow.sha256, publicOracleHash: oracleRow.sha256,
      baseSha256: targetRow.sha256, contextFiles});
    privateObjects.push(store.writePrivate('model-request-package', requestPackage.bytes));
    privateObjects.push(store.writePrivate('repair-inference-timeout', canonical({runId, stage, requestTimeoutMs: CAT_REPAIR_INFERENCE_TIMEOUT_MS})));
    const providerResult = await requestRepairProposal({apiKey, model: selected.id, liveModels: discovery.models, requestPackage: requestPackage.bytes,
      baseSha256: targetRow.sha256,
      persistRawResponse: (bytes) => { const item = store.writePrivate('model-response', bytes); privateObjects.push(item); return item.id; },
      persistResponseContent: (bytes) => { const item = store.writePrivate('model-response-content', bytes); privateObjects.push(item); return item.id; },
      options: {baseUrl, timeoutMs: CAT_REPAIR_INFERENCE_TIMEOUT_MS, retryDns: false,
        authorizationFile: process.env.CAT_INFERENCE_AUTHORIZATION_FILE,
        operationId: runId,
        accountReference: process.env.CAT_NEBIUS_ACCOUNT_REFERENCE}});
    apiKey = '';
    delete process.env.NEBIUS_API_KEY;
    const validatedResponse = store.writePrivate('validated-model-response', canonical(providerResult.proposal));
    privateObjects.push(validatedResponse);
    const providerSafe = {provider: 'Nebius', baseEndpoint: baseUrl.toString(), requestEndpoint: providerResult.endpoint, requestedModel: selected.id,
      returnedModel: providerResult.returnedModel,
      requestId: providerResult.requestId || 'UNKNOWN', operationId: providerResult.operationId ?? 'UNKNOWN', requestPackageSha256: requestPackage.sha256,
      responseSha256: providerResult.rawResponseSha256, validatedResponseSha256: providerResult.validatedResponseSha256,
      finishReason: providerResult.finishReason, usage: providerResult.tokenUsage ?? 'UNKNOWN', latencyMs: providerResult.latencyMs,
      cost: 'UNKNOWN', networkAttempts: providerResult.networkAttempts, recoveredNetworkCause: providerResult.recoveredNetworkCause ?? 'NONE',
      requestTimeoutMs: CAT_REPAIR_INFERENCE_TIMEOUT_MS};
    const providerHttpEvidence = store.writePrivate('provider-http-evidence', canonical(providerResult.httpEvidence));
    privateObjects.push(providerHttpEvidence);
    privateObjects.push(store.writePrivate('provider-metadata', canonical(providerSafe)));
    const patchApplication = applyRepairProposal(candidateRoot, providerResult.proposal);
    const appliedHash = hashRepairTree(candidateRoot);
    boundCandidateHash = appliedHash;

    lifecycle = createRepairLifecycle({workspaceHash: manifest.workspaceHash, baseCandidateHash, publicOracleHash: oracleRow.sha256,
      implementationSha: binding.implementationSha, implementationTreeSha: binding.implementationTreeSha,
      implementationFiles: binding.implementationFiles, candidateRoot, backend: backend.backend,
      persistFrozen: (frozenRoot, freeze) => {
        const rows = inventory(frozenRoot).map((row) => {
          const object = store.writePrivate('frozen-candidate-file', readFileSync(path.join(frozenRoot, ...row.path.split('/'))));
          privateObjects.push(object);
          return {path: row.path, sha256: row.sha256, objectId: object.id};
        });
        const manifestObject = store.writePrivate('frozen-candidate-manifest', canonical({...freeze, rows}));
        privateObjects.push(manifestObject);
        return manifestObject.id;
      },
      createHoldout: () => {
        sealedRun = createHoldout(runId);
        return {bytes: sealedRun.bytes, seal: sealedRun.seal, challengeCount: 1, generatorVersion: HOLDOUT_GENERATOR_VERSION,
          seedCreatedAt: sealedRun.seedCreatedAt, createdAt: sealedRun.sealCreatedAt};
      },
      persistHoldout: (holdout) => { const item = store.writePrivate('sealed-holdout', holdout.bytes); privateObjects.push(item); return item.id; },
    });
    lifecycle.recordModelResult({requestSha256: requestPackage.sha256, responseSha256: providerResult.rawResponseSha256,
      validatedResponseSha256: providerResult.validatedResponseSha256, patchSha256: patchApplication.patchSha256});
    lifecycle.applyCandidate(appliedHash);

    stage = 'public-evaluation';
    const build = backend.execute('build', candidateRoot, {readOnly: false});
    let afterBuild = inventory(candidateRoot);
    let builtHash = hashRepairTree(candidateRoot);
    boundCandidateHash = builtHash;
    lifecycle.recordBuildCandidate(builtHash);
    const buildOperational = build.result.operational;
    const buildSemantic: GateEvidence['semantic'] = buildOperational ? 'ERROR' : build.result.exitCode === 0 ? 'PASS' : 'FAIL';
    const executionEvidence: Record<string, any>[] = [build.dockerCommands as Record<string, any>];
    const buildEvidence = gate('build', builtHash, backend.backend, build.command, build.result.runtimeSha256, build.result.outputSha256,
      build.result.exitCode, buildSemantic, build.executionEvidenceId);
    const gates: GateEvidence[] = [buildEvidence];
    if (buildSemantic === 'PASS') {
      verifyBuildChanges(baseCandidateRows, afterBuild);
      const suite = backend.execute('suite', candidateRoot, {readOnly: true});
      executionEvidence.push(suite.dockerCommands as Record<string, any>);
      gates.push(gate('existing-suite', builtHash, backend.backend, suite.command, suite.result.runtimeSha256, suite.result.outputSha256, suite.result.exitCode,
        suite.result.operational ? 'ERROR' : suite.result.exitCode === 0 ? 'PASS' : 'FAIL', suite.executionEvidenceId));
      const witness = readJson(path.join(projection.workspacePath, 'candidate', 'witness.json'));
      const contract = readJson(path.join(projection.workspacePath, 'candidate', 'contract-v3.json'));
      const oracle = readJson(path.join(projection.workspacePath, 'candidate', 'oracle-v2.json'));
      const observation = backend.execute('observe', candidateRoot, {readOnly: true, input: canonical(witness.input)});
      executionEvidence.push(observation.dockerCommands as Record<string, any>);
      const startedAt = observation.result.observationStartedAt;
      const finishedAt = observation.result.observationFinishedAt;
      const obs = observation.result.observation;
      const supportedClauses = Object.values(contract.clauses ?? {}).flat().filter((clause: any) => clause?.status === 'SOURCE_SUPPORTED').map((clause: any) => clause.id);
      const publicClauseBindingPass = contract.id === 'node-cache-ttl-zero-001' && contract.version === 3 &&
        ['ttl-zero-refreshes-without-expiry', 'ttl-zero-never-deletes'].every((id) => supportedClauses.includes(id)) &&
        Array.isArray(witness.contractClauseIds) && witness.contractClauseIds.includes('ttl-zero-refreshes-without-expiry') && witness.contractClauseIds.includes('ttl-zero-never-deletes');
      const publicContractPass = !!obs && publicClauseBindingPass && canonical(obs) === canonical(witness.expectedObservation);
      const publicOracle = obs ? evaluateObservation(obs, {...oracle, visibility: 'PUBLIC'}) : 'ERROR';
      const publicOutputHash = hash(canonical({observation: obs, startedAt, finishedAt}));
      gates.push(gate('public-contract', builtHash, backend.backend, observation.command, observation.result.runtimeSha256, publicOutputHash,
        observation.result.exitCode, observation.result.operational || !obs ? 'ERROR' : publicContractPass ? 'PASS' : 'FAIL',
        observation.executionEvidenceId, obs ?? undefined, startedAt, finishedAt));
      gates.push(gate('public-oracle-v2', builtHash, backend.backend, observation.command, observation.result.runtimeSha256, publicOutputHash,
        observation.result.exitCode, observation.result.operational || !obs || publicOracle === 'ERROR' ? 'ERROR' : publicOracle,
        observation.executionEvidenceId, obs ?? undefined, startedAt, finishedAt));
    } else {
      const notRun = (id: string) => gate(id, builtHash, backend.backend, ['not-run-after-build-failure'], build.result.runtimeSha256, build.result.outputSha256, 0, 'NOT_RUN');
      gates.push(notRun('existing-suite'), notRun('public-contract'), notRun('public-oracle-v2'));
    }
    privateObjects.push(store.writePrivate('public-gate-evidence', canonical(gates)));
    const publicOutcomes = gates.map(({gate: id, semantic, exitCode}) => ({gate: id, result: semantic, exitCode}));
    const publicOutcome = lifecycle.evaluatePublic(gates);
    if (publicOutcome.outcome === 'PASS') {
      stage = 'freeze-and-blind';
      const frozen = lifecycle.freezeCandidate();
      const sealed = lifecycle.createAndSealHoldout();
      const finalBlind = lifecycle.verifyBlind(({frozenCandidateRoot, holdout}) => {
        const pack = JSON.parse(holdout.bytes.toString('utf8')) as {runId: string; challenges: Record<string, any>[]};
        if (pack.runId !== runId || !Array.isArray(pack.challenges) || pack.challenges.length !== holdout.challengeCount) throw new Error('SEALED_HOLDOUT_INVALID');
        const blindResults: Record<string, any>[] = [];
        let blindPass = true;
        let blindOperational = false;
        for (const challenge of pack.challenges) {
          const blind = backend.execute('observe', frozenCandidateRoot, {readOnly: true, input: canonical(challenge)});
          executionEvidence.push(blind.dockerCommands as Record<string, any>);
          const blindStartedAt = Number.isSafeInteger(blind.result.observationStartedAt)
            ? new Date(blind.result.observationStartedAt).toISOString() : blind.dockerCommands.startedAt;
          const blindEndedAt = Number.isSafeInteger(blind.result.observationFinishedAt)
            ? new Date(blind.result.observationFinishedAt).toISOString() : blind.dockerCommands.finishedAt;
          const observation = blind.result.observation as Record<string, unknown> | null;
          const start = blind.result.observationStartedAt;
          const finish = blind.result.observationFinishedAt;
          const operationalResult = blind.result.operational || !observation || !Number.isSafeInteger(start) || !Number.isSafeInteger(finish)
            ? 'EXECUTION_ERROR' : 'EXECUTION_PASS';
          const semanticResult = operationalResult === 'EXECUTION_ERROR' ? null :
            deriveBlindSemanticResult(challenge, observation!, Number(start), Number(finish));
          blindOperational ||= operationalResult === 'EXECUTION_ERROR';
          blindPass &&= semanticResult === 'SEMANTIC_PASS';
          blindResults.push({runId, challengeId: challenge.challengeId, candidateHash: frozen.candidateHash, holdoutSeal: sealed.seal,
            backend: backend.backend, executionEvidenceId: blind.executionEvidenceId, startedAt: blindStartedAt, endedAt: blindEndedAt,
            observation, observationSha256: hash(canonical(observation)), runtimeSha256: blind.result.runtimeSha256,
            command: blind.command, exitCode: blind.result.exitCode, operationalResult, semanticResult});
        }
        const first = blindResults[0];
        const aggregate: GateEvidence = gate('sealed-holdout', frozen.candidateHash, backend.backend, ['sealed-holdout'], first?.runtimeSha256 ?? hash('missing'),
          first?.observationSha256 ?? hash('missing'), blindOperational ? 1 : 0, blindOperational ? 'ERROR' : blindPass ? 'PASS' : 'FAIL', first?.executionEvidenceId ?? null);
        privateObjects.push(store.writePrivate('blind-gate-evidence', canonical({runId, challengeCount: holdout.challengeCount, blindResults,
          backend: backend.backend, candidateHash: frozen.candidateHash, holdoutSeal: sealed.seal,
          candidateFrozenAt: frozen.candidateFrozenAt, seedCreatedAt: sealed.seedCreatedAt, holdoutCreatedAt: sealed.createdAt})));
        return aggregate;
      });
      result = {decision: finalBlind.decision, reasonCodes: (lifecycle.snapshot() as any).reasonCodes,
        publicOutcomes, blindResult: finalBlind.decision === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : finalBlind.decision === 'ACCEPTED' ? 'PASS' : 'FAIL', candidateFrozenAt: frozen.candidateFrozenAt,
        seedCreatedAt: sealed.seedCreatedAt, holdoutCreatedAt: sealed.createdAt, holdoutSeal: sealed.seal, holdoutChallengeCount: sealed.challengeCount,
        frozenCandidateHash: frozen.candidateHash, candidateHash: frozen.candidateHash, executionBackend: backend.backend};
    } else {
      result = {decision: publicOutcome.decision, reasonCodes: (lifecycle.snapshot() as any).reasonCodes, publicOutcomes,
        candidateHash: builtHash, executionBackend: backend.backend};
    }
    const dockerEvidence = store.writePrivate('docker-lifecycle-evidence', canonical({version: 1, backend: backend.backend, executions: executionEvidence}));
    privateObjects.push(dockerEvidence);
    const lifecycleEvents = (lifecycle.snapshot() as any).lifecycleEvents;
    const lifecycleObject = store.writePrivate('lifecycle-events', canonical(lifecycleEvents));
    privateObjects.push(lifecycleObject);

    stage = 'receipt';
    const snapshot = lifecycle.snapshot() as any;
    const assessed = deriveP05Outcome({
      publicOutcomes: gates.map((item) => ({gate: item.gate, result: item.semantic, exitCode: item.exitCode,
        failureKind: item.failureKind!, reasonCode: item.reasonCode ?? null})),
      blindOutcome: (result.blindResult ?? 'NOT_RUN') as any, candidateHash: result.candidateHash as string,
      freezeValid: !!result.candidateFrozenAt && result.frozenCandidateHash === result.candidateHash,
      holdoutValid: !!result.holdoutSeal && (result.holdoutChallengeCount as number) > 0,
      lifecycleValid: Array.isArray(snapshot.lifecycleEvents), modelEvidenceValid: true,
      backend: backend.backend, executionEvidenceValid: executionEvidence.length > 0,
      sandboxBlockerValid: false,
      receiptDurable: true,
    });
    const {milestone} = assessed;
    const decision = assessed.candidateResult.decision;
    const jobStatus = assessed.candidateResult.jobStatus;
    const reasonCodes = assessed.candidateResult.reasonCodes;
    result = {...result, decision, jobStatus, reasonCodes, blindResult: assessed.blindOutcome};
    const operationalFailure = jobStatus === 'INCONCLUSIVE' ? {stage, code: reasonCodes[0] ?? 'OPERATIONAL_FAILURE'} : null;
    const publicRun = {runId, status: milestone, jobStatus, candidateResult: assessed.candidateResult, experimentIntegrity: assessed.experimentIntegrity,
      candidateAccepted: assessed.candidateAccepted, milestone, operationalFailure, implementationSha: binding.implementationSha, implementationTreeSha: binding.implementationTreeSha,
      implementationFiles: binding.implementationFiles,
      provider: 'Nebius', baseEndpoint: baseUrl.toString(), requestEndpoint: providerResult.endpoint,
      model: selected.id, returnedModel: providerResult.returnedModel, requestId: providerSafe.requestId, operationId: providerSafe.operationId,
      finishReason: providerResult.finishReason, usage: providerResult.tokenUsage ?? 'UNKNOWN', networkAttempts: providerResult.networkAttempts,
      recoveredNetworkCause: providerResult.recoveredNetworkCause ?? 'NONE',
      requestPackageSha256: requestPackage.sha256, modelRequestPackageSha256: requestPackage.sha256, responseSha256: providerResult.rawResponseSha256,
      validatedResponseSha256: providerResult.validatedResponseSha256, patchSha256: patchApplication.patchSha256,
      candidateHash: result.candidateHash, backend: backend.backend,
      sandboxStatus: sandbox.status, sandboxOperationId: sandbox.operationId, sandboxEvidenceSha256: sandbox.safeOutputSha256,
      publicOutcomes, candidateFrozenAt: result.candidateFrozenAt ?? null, frozenCandidateHash: result.frozenCandidateHash ?? null,
      seedCreatedAt: result.seedCreatedAt ?? null, holdoutCreatedAt: result.holdoutCreatedAt ?? null, holdoutSeal: result.holdoutSeal ?? null,
      holdoutChallengeCount: result.holdoutChallengeCount ?? 0,
      blindResult: result.blindResult ?? 'NOT_RUN', decision, reasonCodes: result.reasonCodes};
    trackPublic('public-run-summary', canonical(publicRun));
    const privateData = {runId, implementationSha: binding.implementationSha, implementationTreeSha: binding.implementationTreeSha,
      implementationFiles: binding.implementationFiles, candidateHash: result.candidateHash as string,
      candidateResult: assessed.candidateResult, candidateAccepted: assessed.candidateAccepted, experimentIntegrity: assessed.experimentIntegrity, milestone, jobStatus,
      decision, reasonCodes: result.reasonCodes, state: snapshot.state, operationalFailure,
      provider: providerSafe, patchApplication, modelResponseObjectId: providerResult.rawResponseObjectId,
      modelResponseContentObjectId: providerResult.responseContentObjectId,
      modelRequestObjectId: privateObjects.find((o) => o.role === 'model-request-package')?.id,
      requestPackageSha256: requestPackage.sha256, responseSha256: providerResult.rawResponseSha256,
      modelRequestPackageSha256: requestPackage.sha256,
      validatedResponseSha256: providerResult.validatedResponseSha256, publicEvidence: gates,
      publicGateEvidenceSha256: privateObjects.find((o) => o.role === 'public-gate-evidence')?.sha256,
      frozenCandidateManifestSha256: privateObjects.find((o) => o.role === 'frozen-candidate-manifest')?.sha256 ?? null,
      candidateFrozenAt: result.candidateFrozenAt ?? null, frozenCandidateHash: result.frozenCandidateHash ?? null,
      seedCreatedAt: result.seedCreatedAt ?? null, holdoutCreatedAt: result.holdoutCreatedAt ?? null, holdoutSeal: result.holdoutSeal ?? null,
      blindResult: result.blindResult ?? 'NOT_RUN', holdoutChallengeCount: result.holdoutChallengeCount ?? 0, lifecycleEventsSha256: lifecycleObject.sha256,
      holdoutObjectId: snapshot.holdoutObjectId ?? null, executionBackend: backend.backend,
      sandboxStatus: sandbox.status, sandboxOperationId: sandbox.operationId,
      sandboxEvidenceSha256: sandbox.safeOutputSha256, sandboxBlockerReason: sandbox.reason ?? null,
      dockerEvidenceSha256: dockerEvidence.sha256,
      dependencyTreeSha256: backend.dependencyManifest.sha256, objects: privateObjects};
    const privateReceiptOut = store.createPrivateReceipt({...privateData, ...binding});
    privateReceipt = privateReceiptOut.object;
    const publicReceiptOut = store.createPublicReceipt({runId, ...binding, candidateHash: result.candidateHash as string,
      candidateResult: assessed.candidateResult, experimentIntegrity: assessed.experimentIntegrity, milestone, jobStatus,
      operationalFailure, decision, reasonCodes: result.reasonCodes, status: publicRun.status, executionBackend: backend.backend,
      sandboxStatus: sandbox.status, sandboxOperationId: sandbox.operationId, sandboxEvidenceSha256: sandbox.safeOutputSha256,
      candidateAccepted: assessed.candidateAccepted, provider: 'Nebius', baseEndpoint: baseUrl.toString(), requestEndpoint: providerResult.endpoint,
      model: selected.id, returnedModel: providerResult.returnedModel, requestId: providerSafe.requestId,
      operationId: providerSafe.operationId, finishReason: providerResult.finishReason,
      usage: providerResult.tokenUsage ?? 'UNKNOWN', networkAttempts: providerResult.networkAttempts,
      recoveredNetworkCause: providerResult.recoveredNetworkCause ?? 'NONE',
      holdoutChallengeCount: result.holdoutChallengeCount ?? 0,
      requestPackageSha256: requestPackage.sha256, responseSha256: providerResult.rawResponseSha256,
      modelRequestPackageSha256: requestPackage.sha256,
      validatedResponseSha256: providerResult.validatedResponseSha256, patchSha256: patchApplication.patchSha256,
      candidateFrozenAt: result.candidateFrozenAt ?? null, frozenCandidateHash: result.frozenCandidateHash ?? null,
      seedCreatedAt: result.seedCreatedAt ?? null, holdoutCreatedAt: result.holdoutCreatedAt ?? null, holdoutSeal: result.holdoutSeal ?? null,
      blindResult: result.blindResult ?? 'NOT_RUN', publicOutcomes, publicObjects}, privateReceipt);
    publicReceipt = publicReceiptOut.object;
    result = {...result, status: publicRun.status, jobStatus, candidateResult: assessed.candidateResult,
      experimentIntegrity: assessed.experimentIntegrity, milestone, runId, publicReceiptSha256: publicReceipt.sha256,
      privateReceiptSha256: privateReceipt.sha256, receiptRoot: path.relative(ROOT, store.root).split(path.sep).join('/'),
      model: selected.id, requestPackageSha256: requestPackage.sha256, responseSha256: providerResult.rawResponseSha256,
      validatedResponseSha256: providerResult.validatedResponseSha256, requestEndpoint: providerResult.endpoint,
      requestId: providerResult.requestId, operationId: providerResult.operationId,
      finishReason: providerResult.finishReason, recoveredNetworkCause: providerResult.recoveredNetworkCause,
      networkAttempts: providerResult.networkAttempts, usage: providerResult.tokenUsage ?? 'UNKNOWN', latencyMs: providerResult.latencyMs,
      attemptCount: 1, changedPaths: patchApplication.changedPaths, patchSha256: patchApplication.patchSha256,
      baseCandidateHash, executionBackend: backend.backend, sandboxStatus: sandbox.status};
  } catch (error) {
    apiKey = '';
    delete process.env.NEBIUS_API_KEY;
    const code = resolveTokenFactoryFailureCode(error);
    const decision = null;
    const candidateResult = {jobStatus: 'INCONCLUSIVE', decision, reasonCodes: [code]};
    result = {status: 'CAT_P05S_BLOCKED', milestone: 'CAT_P05S_BLOCKED', experimentIntegrity: 'INCOMPLETE',
      jobStatus: 'INCONCLUSIVE', candidateResult, stage, decision, reasonCodes: [code], candidateHash: boundCandidateHash};
    try {
      const diagnostic = getTokenFactoryFailureDiagnostic(error);
      if (diagnostic) {
        const value = (field: keyof typeof diagnostic) => diagnostic[field] ?? 'UNKNOWN';
        process.stdout.write([
          `CAT_NETWORK_ERROR_NAME=${value('errorName')}`,
          `CAT_NETWORK_CAUSE_NAME=${value('causeName')}`,
          `CAT_NETWORK_CAUSE_CODE=${value('causeCode')}`,
          `CAT_NETWORK_CAUSE_ERRNO=${value('causeErrno')}`,
          `CAT_NETWORK_CAUSE_SYSCALL=${value('causeSyscall')}`,
          `CAT_NETWORK_CAUSE_HOSTNAME=${value('causeHostname')}`,
          `CAT_NETWORK_CAUSE_ADDRESS=${value('causeAddress')}`,
          `CAT_NETWORK_CAUSE_PORT=${value('causePort')}`,
        ].join('\n') + '\n');
        privateObjects.push(store.writePrivate('terminal-provider-diagnostic', canonical({runId, stage, diagnostic})));
      }
      const operationalFailure = {stage, code};
      privateObjects.push(store.writePrivate('terminal-failure', canonical({runId, stage, code, implementationSha: binding.implementationSha, decision})));
      const failurePublic = {runId, status: 'CAT_P05S_BLOCKED', implementationSha: binding.implementationSha, candidateAvailable: boundCandidateHash !== '0'.repeat(64),
        candidateHash: boundCandidateHash, jobStatus: 'INCONCLUSIVE', candidateResult, experimentIntegrity: 'INCOMPLETE', milestone: 'CAT_P05S_BLOCKED',
        operationalFailure, decision, reasonCodes: [code]};
      trackPublic('terminal-summary', canonical(failurePublic));
      const privateOut = store.createPrivateReceipt({...binding, runId, candidateHash: boundCandidateHash,
        decision, jobStatus: 'INCONCLUSIVE', candidateResult, experimentIntegrity: 'INCOMPLETE', milestone: 'CAT_P05S_BLOCKED',
        operationalFailure, reasonCodes: [code], stage, objects: privateObjects});
      privateReceipt = privateOut.object;
      const publicOut = store.createPublicReceipt({...binding, runId, candidateHash: boundCandidateHash,
        decision, jobStatus: 'INCONCLUSIVE', candidateResult, experimentIntegrity: 'INCOMPLETE', milestone: 'CAT_P05S_BLOCKED',
        operationalFailure, reasonCodes: [code], status: 'CAT_P05S_BLOCKED',
        candidateAvailable: failurePublic.candidateAvailable, publicObjects}, privateReceipt);
      publicReceipt = publicOut.object;
      result = {...result, publicReceiptSha256: publicReceipt.sha256, privateReceiptSha256: privateReceipt.sha256,
        receiptRoot: path.relative(ROOT, store.root).split(path.sep).join('/')};
    } catch { result.receiptPersistence = 'FAILED'; }
  } finally {
    apiKey = '';
    delete process.env.NEBIUS_API_KEY;
    cleanup();
  }
  if (publicReceipt) {
    const verification = verifyV5Receipt(ROOT, runId, publicReceipt.sha256);
    result.postCleanupReceiptVerification = verification.verified;
  }
  process.stdout.write([
    'CAT_REPAIR_CASE=node-cache-ttl-zero-001', `CAT_IMPLEMENTATION_SHA=${binding.implementationSha}`,
    'CAT_PROVIDER=Nebius', `CAT_BASE_ENDPOINT=${baseUrl.toString()}`, `CAT_MODEL=${(result as any).model ?? 'UNKNOWN'}`,
    `CAT_REQUEST_ENDPOINT=${(result as any).requestEndpoint ?? 'UNKNOWN'}`, `CAT_OPERATION_ID=${(result as any).operationId ?? 'UNKNOWN'}`,
    `CAT_FINISH_REASON=${(result as any).finishReason ?? 'UNKNOWN'}`, `CAT_RECOVERED_DNS_CAUSE=${(result as any).recoveredNetworkCause ?? 'NONE'}`,
    `CAT_REQUEST_ID=${(result as any).requestId ?? 'UNKNOWN'}`, `CAT_MODEL_ATTEMPTS=${(result as any).attemptCount ?? 0}`,
    `CAT_NETWORK_ATTEMPTS=${(result as any).networkAttempts ?? 'UNKNOWN'}`, `CAT_USAGE=${canonical((result as any).usage ?? 'UNKNOWN')}`,
    `CAT_LATENCY_MS=${(result as any).latencyMs ?? 'UNKNOWN'}`, 'CAT_COST=UNKNOWN',
    `CAT_MODEL_RESULT_SUMMARY=${(result as any).attemptCount ? 'one-file validated replacement' : 'NOT_AVAILABLE'}`,
    `CAT_CHANGED_PATHS=${canonical((result as any).changedPaths ?? [])}`,
    `CAT_EXECUTION_BACKEND=${(result as any).executionBackend ?? 'UNKNOWN'}`, `CAT_SANDBOX_STATUS=${(result as any).sandboxStatus ?? 'UNKNOWN'}`,
    `CAT_REQUEST_PACKAGE_SHA256=${(result as any).requestPackageSha256 ?? 'UNKNOWN'}`, `CAT_RESPONSE_SHA256=${(result as any).responseSha256 ?? 'UNKNOWN'}`,
    `CAT_VALIDATED_RESPONSE_SHA256=${(result as any).validatedResponseSha256 ?? 'UNKNOWN'}`,
    `CAT_PATCH_SHA256=${(result as any).patchSha256 ?? 'UNKNOWN'}`, `CAT_CANDIDATE_SHA256=${(result as any).candidateHash ?? 'UNKNOWN'}`,
    `CAT_BASE_CANDIDATE_SHA256=${(result as any).baseCandidateHash ?? 'UNKNOWN'}`,
    `CAT_PUBLIC_GATES=${canonical((result as any).publicOutcomes ?? [])}`, `CAT_CANDIDATE_FROZEN=${(result as any).candidateFrozenAt ?? 'NO'}`,
    `CAT_FROZEN_CANDIDATE_SHA256=${(result as any).frozenCandidateHash ?? 'NONE'}`,
    `CAT_HOLDOUT_SEAL=${(result as any).holdoutSeal ?? 'NONE'}`, `CAT_HOLDOUT_CHALLENGES=${(result as any).holdoutChallengeCount ?? 0}`,
    `CAT_HOLDOUT_SEED_CREATED_AT=${(result as any).seedCreatedAt ?? 'NONE'}`, `CAT_HOLDOUT_CREATED_AT=${(result as any).holdoutCreatedAt ?? 'NONE'}`,
    `CAT_BLIND_RESULT=${(result as any).blindResult ?? 'NOT_RUN'}`, `CAT_JOB_STATUS=${(result as any).jobStatus ?? 'INCONCLUSIVE'}`,
    `CAT_EXPERIMENT_INTEGRITY=${(result as any).experimentIntegrity ?? 'INCOMPLETE'}`,
    `CAT_P05S_MILESTONE=${(result as any).milestone ?? 'CAT_P05S_BLOCKED'}`,
    `CAT_DECISION=${(result as any).decision ?? 'null'}`, `CAT_REASON_CODES=${canonical((result as any).reasonCodes ?? [])}`,
    `CAT_RECEIPT=${(result as any).receiptRoot ?? 'UNKNOWN'}`, `CAT_PUBLIC_RECEIPT_SHA256=${(result as any).publicReceiptSha256 ?? 'UNKNOWN'}`,
    `POST_CLEANUP_RECEIPT_VERIFY=${(result as any).postCleanupReceiptVerification === true ? 'PASS' : 'NOT_RUN'}`,
  ].join('\n') + '\n');
  if ((result as any).status === 'CAT_P05S_BLOCKED') process.exitCode = 1;
}

try { await main(); }
catch (error) {
  const code = resolveTokenFactoryFailureCode(error);
  process.stderr.write(`CAT_P05S_BLOCKED=${code}\n`);
  process.exitCode = 1;
}
