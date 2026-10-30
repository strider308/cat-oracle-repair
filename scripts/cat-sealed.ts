import {createHash, randomUUID} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {finalizeReceipt} from '../src/core/receipt.ts';
import {canonical} from '../src/oracle/canonical.ts';
import {evaluateObservation} from '../src/oracle/evaluate.ts';
import {calibrateOracle} from '../src/oracle/calibrate.ts';
import {createHoldout, HOLDOUT_GENERATOR_VERSION} from '../src/verifier/holdout-generator.ts';
import {decideFinal, sha256, verifyHoldout} from '../src/verifier/sealed-verifier.ts';
import {verifyP04Receipt} from '../src/verifier/receipt-v3.ts';
import {runtimeDependencyPaths} from '../src/verifier/runtime-dependencies.ts';
import {stopTimedOutContainer} from '../src/verifier/docker-cleanup.ts';
import {runP03Hero, verifyP03ReceiptDetailed, verifyP03SupersessionRecord} from '../src/evaluation/p03-runner.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASE = path.join(ROOT, 'fixtures/hero/node-cache-ttl-zero-001');
const IMAGE = 'sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32';
const jsonMode = process.argv.includes('--json');
const reveal = process.argv.includes('--reveal');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const repoPath = (file) => path.relative(ROOT, file).split(path.sep).join('/');
function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }
function manifest(dir) {
  const rows = [];
  const walk = (current) => {
    for (const item of readdirSync(current, {withFileTypes: true})) {
      const file = path.join(current, item.name);
      const rel = path.relative(dir, file).split(path.sep).join('/');
      if (item.isSymbolicLink() || item.name.toLowerCase() === '.git') throw new Error('PROJECTION_CONTENT_REJECTED:' + rel);
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) rows.push({path: rel, sha256: hash(readFileSync(file))});
      else throw new Error('PROJECTION_FILE_TYPE_REJECTED:' + rel);
    }
  };
  walk(dir);
  rows.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return rows;
}
function projectCandidate(name, runDir) {
  const dest = path.join(runDir, name);
  mkdirSync(dest);
  let source;
  if (name === 'v3') source = path.join(CASE, 'suite/source');
  else if (name === 'good') source = path.join(CASE, 'upstream/4.0.0');
  else if (name === 'equivalent') source = path.join(CASE, 'candidates/equivalent');
  else if (name === 's2') source = path.join(CASE, 'candidates/s2-overbroad-zero-fix');
  else throw new Error('CANDIDATE_UNKNOWN');
  const files = name === 'v3' || name === 'good' ? ['index.js', 'lib/node_cache.js'] : ['index.js'];
  for (const rel of files) {
    const file = path.join(source, rel);
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('CANDIDATE_FILE_INVALID:' + rel);
    mkdirSync(path.dirname(path.join(dest, rel)), {recursive: true});
    cpSync(file, path.join(dest, rel));
  }
  const rows = manifest(dest);
  return {path: dest, rows, hash: sha256(canonical(rows)), files: rows.map((row) => row.path)};
}
function projectDependencies(runDir) {
  const source = path.join(CASE, 'suite/node_modules');
  const dest = path.join(runDir, 'dependencies', 'node_modules');
  for (const rel of runtimeDependencyPaths(path.join(CASE, 'suite'))) {
    const file = path.join(source, rel);
    const target = path.join(dest, rel);
    mkdirSync(path.dirname(target), {recursive: true});
    cpSync(file, target);
  }
  const rows = manifest(dest);
  return {path: dest, rows, hash: sha256(canonical(rows))};
}
function dockerHost() {
  const name = execFileSync('docker', ['context', 'show'], {encoding: 'utf8', windowsHide: true}).trim();
  const host = execFileSync('docker', ['context', 'inspect', '--format={{.Endpoints.docker.Host}}', name], {encoding: 'utf8', windowsHide: true}).trim();
  const allowed = process.platform === 'win32' ? ['npipe:////./pipe/dockerDesktopLinuxEngine', 'npipe:////./pipe/docker_engine'].includes(host) : host.startsWith('unix:///');
  if (!allowed) throw new Error('LOCAL_DOCKER_ENDPOINT_REQUIRED');
  return host;
}
let host = '';
function docker(args, input = '') {
  const config = path.join(os.tmpdir(), 'cat-p04-docker-' + randomUUID());
  mkdirSync(config);
  try {
    const env = {PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir(), DOCKER_CONFIG: config, DOCKER_HOST: host};
    const result = spawnSync('docker', args, {cwd: ROOT, env, input, encoding: 'utf8', timeout: 90000, maxBuffer: 8192, windowsHide: true});
    if (result.error || result.signal || result.status !== 0) {
      if (result.error?.code === 'ETIMEDOUT' && args.includes('--name')) {
        const name = args[args.indexOf('--name') + 1];
        stopTimedOutContainer(name, (cleanupArgs) => spawnSync('docker', cleanupArgs, {cwd: ROOT, env: {PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir(), DOCKER_CONFIG: config, DOCKER_HOST: host}, encoding: 'utf8', timeout: 10000, windowsHide: true}));
      }
      throw new Error('CONTAINER_INCONCLUSIVE:' + (result.error?.message ?? result.stderr?.slice(0, 256) ?? result.status));
    }
    return result.stdout;
  } finally { rmSync(config, {recursive: true, force: true}); }
}
function baseArgs(name) {
  return ['run', '--pull=never', '--rm', '-i', '--name', name, '--network', 'none', '--read-only', '--pids-limit', '64', '--memory', '256m', '--cpus', '1',
    '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m'];
}
function runCandidate(name, candidate, dependencies, input, adapter) {
  const id = 'cat-p04-' + randomUUID();
  const args = baseArgs(id).concat(['--env', 'NODE_PATH=/deps/node_modules', '--mount', 'type=bind,source=' + candidate.path + ',target=/candidate,readonly',
    '--mount', 'type=bind,source=' + dependencies.path + ',target=/deps/node_modules,readonly',
    '--mount', 'type=bind,source=' + adapter + ',target=/adapter.cjs,readonly', IMAGE, 'node', '/adapter.cjs', '/candidate', 'node-cache']);
  const parsed = JSON.parse(docker(args, JSON.stringify(input)));
  if (!parsed.observation || Object.keys(parsed).sort().join('|') !== 'observation|runtime|sourceTreeSha256') throw new Error('CANDIDATE_PROTOCOL_INVALID');
  const expectedRows = candidate.rows;
  if (parsed.runtime.length !== 1 || parsed.runtime[0].path !== 'index.js' || parsed.runtime[0].sha256 !== expectedRows.find((row) => row.path === 'index.js')?.sha256) throw new Error('RUNTIME_BINDING_MISMATCH:' + name);
  return parsed.observation;
}
function probe(candidate, runDir) {
  const probeDir = path.join(runDir, 'probe');
  mkdirSync(probeDir);
  const source = `const fs=require('node:fs');const net=require('node:net');const cp=require('node:child_process');const names=['NEBIUS_API_KEY','NEBIUS_IAM_TOKEN','NEBIUS_SANDBOX_IAM_TOKEN','NEBIUS_PROJECT_ID','GITHUB_TOKEN','GH_TOKEN','SSH_AUTH_SOCK','CAT_HOLDOUT_SEED','CAT_HOLDOUT_PATH','CAT_HOLDOUT_CONTENT'];const paths=['/evaluator/holdout.json','/private/holdout.json','/private/evidence.json','/receipts','/.agent-runs','/workspace/.git','/candidate/.git'];const readable=paths.some(p=>{try{fs.readFileSync(p);return true}catch{return false}});let git=false;try{git=cp.spawnSync('git',['rev-parse','--is-inside-work-tree'],{cwd:'/candidate',encoding:'utf8'}).status===0}catch{};const outbound=new Promise(resolve=>{const s=net.createConnection({host:'1.1.1.1',port:53});s.setTimeout(350);s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false)})});outbound.then(ok=>process.stdout.write(JSON.stringify({privateReadable:readable,gitMetadataAccessible:git||fs.existsSync('/candidate/.git'),sensitiveEnvironmentNamesPresent:names.some(n=>Object.hasOwn(process.env,n)),outboundNetworkAccessible:ok})+'\\n'));`;
  const file = path.join(probeDir, 'probe.cjs');
  writeFileSync(file, source);
  const id = 'cat-p04-probe-' + randomUUID();
  const args = baseArgs(id).concat(['--mount', 'type=bind,source=' + candidate.path + ',target=/candidate,readonly', '--mount', 'type=bind,source=' + probeDir + ',target=/probe,readonly', IMAGE, 'node', '/probe/probe.cjs']);
  return JSON.parse(docker(args));
}
async function main() {
  const p03Replay = await runP03Hero();
  if (p03Replay.supersessionVerified !== true || verifyP03ReceiptDetailed(readJson(path.join(ROOT, p03Replay.receiptPath)), ROOT).overall !== 'VERIFIED') throw new Error('P03_REPLAY_NOT_VERIFIED');
  const p03SupersessionPath = p03Replay.supersessionPath;
  const p03Supersession = readJson(path.join(ROOT, p03SupersessionPath));
  if (!verifyP03SupersessionRecord(p03Supersession, ROOT)) throw new Error('P03_SUPERSESSION_NOT_VERIFIED');
  const p03RunId = path.basename(p03Replay.receiptPath, '.json');
  host = dockerHost();
  const runId = randomUUID();
  const runDir = path.join(os.tmpdir(), 'cat-p04-projection-' + runId);
  const sealedRun = createHoldout(runId);
  const evidenceDir = path.join(ROOT, 'evidence/sealed');
  const privateEvidenceRel = 'evidence/sealed-private/' + runId + '.json';
  try {
    mkdirSync(runDir);
    mkdirSync(evidenceDir, {recursive: true});
    const contractPath = path.join(CASE, 'contract-v3.json');
    const oraclePath = path.join(CASE, 'oracle-v2.json');
    const contractBytes = readFileSync(contractPath);
    const contract = JSON.parse(contractBytes.toString('utf8'));
    if (contract.version !== 3 || !contract.clauses?.MUST_PRESERVE?.some((clause) => clause.id === 'positive-ttl-refresh-remains-finite')) throw new Error('P04_CONTRACT_CLAUSE_MISSING');
    const oracleBytes = readFileSync(oraclePath);
    const oracle = readJson(oraclePath);
    const witness = readJson(path.join(CASE, 'witness.json'));
    const adapter = path.join(CASE, 'adapter.cjs');
    const candidates = Object.fromEntries(['v3', 'good', 'equivalent', 's2'].map((name) => [name, projectCandidate(name, runDir)]));
    const dependencies = projectDependencies(runDir);
    const publicResults = {};
    for (const name of Object.keys(candidates)) {
      const observation = runCandidate(name, candidates[name], dependencies, witness.input, adapter);
      publicResults[name] = {observation, outcome: evaluateObservation(observation, {...oracle, visibility: 'PUBLIC'})};
    }
    if (publicResults.s2.outcome !== 'PASS' || publicResults.good.outcome !== 'PASS' || publicResults.equivalent.outcome !== 'PASS' || publicResults.v3.outcome !== 'FAIL') throw new Error('PUBLIC_CALIBRATION_FAILED');
    const publicOracleStatus = calibrateOracle(publicResults.v3.outcome === 'FAIL', publicResults.good.outcome === 'PASS', publicResults.equivalent.outcome === 'PASS', publicResults.s2.outcome === 'FAIL');
    const sealBefore = readFileSync(sealedRun.artifactPath);
    if (!verifyHoldout(sealBefore, sealedRun.seal)) throw new Error('HOLDOUT_SEAL_INVALID');
    const candidateStartedAt = new Date().toISOString();
    if (Date.parse(sealedRun.sealCreatedAt) > Date.parse(candidateStartedAt)) throw new Error('HOLDOUT_SEAL_ORDER_INVALID');
    const holdout = {};
    const annexEvaluations = {};
    for (const name of ['s2', 'good', 'equivalent']) {
      const began = Date.now();
      const observation = runCandidate(name, candidates[name], dependencies, sealedRun.challenge, adapter);
      const finished = Date.now();
      const expired = observation.expiresAt;
      const ttlOk = Number.isFinite(expired) && expired > began - 2000 && expired <= finished + sealedRun.challenge.updatedTtlSeconds * 1000 + 2000;
      const pass = observation.ttlReturned === true && observation.found === true && observation.value === sealedRun.challenge.value && ttlOk;
      holdout[name] = {outcome: pass ? 'PASS' : 'FAIL', clauseId: 'positive-ttl-refresh-remains-finite'};
      annexEvaluations[name] = {startedAtMs: began, finishedAtMs: finished, observation};
      if (!verifyHoldout(readFileSync(sealedRun.artifactPath), sealedRun.seal)) throw new Error('HOLDOUT_MUTATED_DURING_EXECUTION');
    }
    holdout.v3 = {outcome: 'NOT_RUN', clauseId: 'public-gate-rejected'};
    const decisions = {
      v3: decideFinal({publicPass: false, holdoutStatus: 'UNAVAILABLE'}),
      good: decideFinal({publicPass: true, holdoutStatus: 'EXECUTED', holdoutPass: holdout.good.outcome === 'PASS'}),
      equivalent: decideFinal({publicPass: true, holdoutStatus: 'EXECUTED', holdoutPass: holdout.equivalent.outcome === 'PASS'}),
      s2: decideFinal({publicPass: true, holdoutStatus: 'EXECUTED', holdoutPass: holdout.s2.outcome === 'PASS'}),
    };
    const leakage = probe(candidates.s2, runDir);
    const leakageEvidence = {gitMetadataAccessible: leakage.gitMetadataAccessible, privateEvaluatorAccessible: leakage.privateReadable,
      sensitiveEnvironmentNamesPresent: leakage.sensitiveEnvironmentNamesPresent, outboundNetworkAccessible: leakage.outboundNetworkAccessible,
      candidateWorkspaceHash: candidates.s2.hash, result: !leakage.gitMetadataAccessible && !leakage.privateReadable && !leakage.sensitiveEnvironmentNamesPresent && !leakage.outboundNetworkAccessible ? 'PASS' : 'FAIL'};
    const leakageRel = 'evidence/sealed/' + runId + '-leakage.json';
    writeFileSync(path.join(ROOT, leakageRel), JSON.stringify(leakageEvidence, null, 2) + '\n', {flag: 'wx'});
    if (decisions.s2 !== 'REJECTED' || holdout.s2.outcome !== 'FAIL' || decisions.good !== 'ACCEPTED' || decisions.equivalent !== 'ACCEPTED' || leakageEvidence.result !== 'PASS') throw new Error('SEALED_CALIBRATION_FAILED');
    const sourcePaths = {
      'p04-runner': 'scripts/cat-sealed.ts', 'candidate-adapter': 'fixtures/hero/node-cache-ttl-zero-001/adapter.cjs',
      'oracle-canonical': 'src/oracle/canonical.ts', 'oracle-evaluate': 'src/oracle/evaluate.ts', 'oracle-calibrate': 'src/oracle/calibrate.ts',
      'holdout-generator': 'src/verifier/holdout-generator.ts', 'sealed-verifier': 'src/verifier/sealed-verifier.ts',
      'receipt-verifier': 'src/verifier/receipt-v3.ts', 'p03-replay-verifier': 'src/evaluation/p03-runner.ts', 'runtime-dependencies': 'src/verifier/runtime-dependencies.ts', 'docker-cleanup': 'src/verifier/docker-cleanup.ts', 'receipt-core': 'src/core/receipt.ts', 'package-manifest': 'package.json',
    };
    const artifactPaths = {'contract-v3': repoPath(contractPath), 'public-oracle-v2': repoPath(oraclePath),
      'p03-current-receipt': p03Replay.receiptPath, 'p03-supersession-record': p03SupersessionPath, 'private-evidence': privateEvidenceRel,
      'source-records': repoPath(path.join(CASE, 'sources.json')),
      'source-v3-code': repoPath(path.join(CASE, 'upstream/3.2.1/_src/lib/node_cache.coffee')),
      'source-v4-code': repoPath(path.join(CASE, 'upstream/4.0.0/_src/lib/node_cache.coffee')),
      'source-v4-api': repoPath(path.join(CASE, 'upstream/node-cache-4.0.0-README.md')),
      'public-witness': repoPath(path.join(CASE, 'witness.json')),
      'suite-lockfile': repoPath(path.join(CASE, 'suite/package-lock.json')), leakage: leakageRel};
    for (const [id, rel] of Object.entries(sourcePaths)) artifactPaths['implementation-' + id] = rel;
    const sourceDirs = {v3: 'suite/source', good: 'upstream/4.0.0', equivalent: 'candidates/equivalent', s2: 'candidates/s2-overbroad-zero-fix'};
    for (const [name, candidate] of Object.entries(candidates)) for (const row of candidate.rows) {
      artifactPaths['candidate-' + name + '-' + row.path.replaceAll('/', '-') ] = repoPath(path.join(CASE, sourceDirs[name], ...row.path.split('/')));
    }
    for (const row of dependencies.rows) artifactPaths['runtime-dependency-' + row.path.replaceAll('/', '-')] = repoPath(path.join(CASE, 'suite/node_modules', ...row.path.split('/')));
    const privateAnnex = {version: 1, runId, privateEvidenceId: sealedRun.privateEvidenceId, holdoutPack: JSON.parse(sealedRun.bytes.toString('utf8')), evaluations: annexEvaluations};
    const privateAnnexBytes = Buffer.from(JSON.stringify(privateAnnex));
    mkdirSync(path.join(ROOT, 'evidence/sealed-private'), {recursive: true});
    writeFileSync(path.join(ROOT, privateEvidenceRel), privateAnnexBytes, {flag: 'wx', mode: 0o600});
    const artifactHashes = Object.fromEntries(Object.entries(artifactPaths).map(([id, rel]) => [id, hash(readFileSync(path.join(ROOT, rel)))]));
    const environmentDigest = hash(canonical({image: IMAGE, dockerHost: host, network: 'none', user: '10001:10001', capDrop: 'ALL'}));
    const publicOutcomeMap = Object.fromEntries(Object.entries(publicResults).map(([id, row]) => [id, row.outcome]));
    const sealedOutcomeMap = Object.fromEntries(Object.entries(holdout).map(([id, row]) => [id, row.outcome]));
    const decisionMap = decisions;
    const receipt = finalizeReceipt({receiptVersion: 4, runId, createdAt: new Date().toISOString(), baseSha: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
      p03ReplayRunId: p03RunId, p03ReplayReceiptHash: p03Replay.receiptHash,
      p03HistoricalReceiptHash: p03Supersession.historicalReceiptHash,
      p03SupersessionRecordPath: p03SupersessionPath, p03SupersessionRecordHash: hash(readFileSync(path.join(ROOT, p03SupersessionPath))),
      candidate: {candidateSha: candidates.s2.hash, contractHash: hash(contractBytes), jobStatus: 'COMPLETED', decision: decisions.s2,
        reasonCodes: ['PUBLIC_PASS', 'SEALED_HOLDOUT_FAIL'], requiredGateIds: ['public-v2', 'sealed-positive-expiry'], gates: {'public-v2': 'PASS', 'sealed-positive-expiry': 'FAIL'}, evidenceManifestHash: hash(canonical({publicResults: publicOutcomeMap, sealedResults: sealedOutcomeMap, decisions: decisionMap}))},
      contractHash: hash(contractBytes), publicOracleHash: hash(oracleBytes), holdoutGeneratorVersion: HOLDOUT_GENERATOR_VERSION,
      holdoutStatus: 'EXECUTED', holdoutSeal: sealedRun.seal, holdoutChallengeCount: 1, sealCreatedAt: sealedRun.sealCreatedAt, candidateStartedAt,
      candidateWorkspaceHash: candidates.s2.hash, candidateWorkspaceHashes: Object.fromEntries(Object.entries(candidates).map(([id, value]) => [id, value.hash])),
      candidateProjectionManifests: Object.fromEntries(Object.entries(candidates).map(([id, value]) => [id, value.rows])),
      publicOracleStatus,
      adversarialCandidate: {id: 'S2-overbroad-zero-fix', candidateArtifactHash: candidates.s2.hash, provenance: 'MANUAL_RESEARCH', violatedClauseIds: ['positive-ttl-refresh-remains-finite'], publicOracleOutcome: publicResults.s2.outcome, sealedOutcome: holdout.s2.outcome},
      publicResults: publicOutcomeMap, sealedResults: sealedOutcomeMap, decisions, leakageEvidenceHash: hash(readFileSync(path.join(ROOT, leakageRel))),
      privateEvidenceId: sealedRun.privateEvidenceId, privateEvidenceSha256: sha256(privateAnnexBytes),
      privateEvidencePath: privateEvidenceRel,
      runtimeDependencyTreeHash: dependencies.hash, runtimeDependencyManifest: dependencies.rows,
      implementationHashes: Object.fromEntries(Object.keys(sourcePaths).map((id) => [id, artifactHashes['implementation-' + id]])), environmentDigest,
      sourceHashes: {contract: hash(contractBytes), publicOracle: hash(oracleBytes), sourceV3Code: hash(readFileSync(path.join(CASE, 'upstream/3.2.1/_src/lib/node_cache.coffee'))),
        sourceV4Code: hash(readFileSync(path.join(CASE, 'upstream/4.0.0/_src/lib/node_cache.coffee'))), sourceV4Api: hash(readFileSync(path.join(CASE, 'upstream/node-cache-4.0.0-README.md')))}, artifactPaths, artifactHashes,
      commands: ['npm run cat:sealed'], modelIds: [], providerOperationIds: [], knownLimits: ['Local Docker process isolation is not cryptographic secrecy from the same-identity builder and is not production isolation.', 'The local holdout protects the full challenge pack; each candidate sees the single challenge input while it executes.'], previousEventHash: null});
    const receiptRel = 'evidence/sealed/' + runId + '.json';
    writeFileSync(path.join(ROOT, receiptRel), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
    if (!verifyP04Receipt(receipt, ROOT, privateAnnexBytes)) throw new Error('P04_RECEIPT_INVALID');
    const result = {caseId: 'node-cache-ttl-zero-001', contractHash: receipt.contractHash, publicOracleHash: receipt.publicOracleHash,
      holdoutGeneratorVersion: HOLDOUT_GENERATOR_VERSION, holdoutSeal: sealedRun.seal, holdoutChallengeCount: 1, publicOracleStatus,
      candidates: {s2: {public: publicResults.s2.outcome, holdout: holdout.s2.outcome, decision: decisions.s2}, good: {public: publicResults.good.outcome, holdout: holdout.good.outcome, decision: decisions.good}, equivalent: {public: publicResults.equivalent.outcome, holdout: holdout.equivalent.outcome, decision: decisions.equivalent}, v3: {public: publicResults.v3.outcome, holdout: 'NOT_RUN', decision: decisions.v3}},
      leakage: leakageEvidence, candidateWorkspaceHash: candidates.s2.hash, candidateWorkspaceHashes: receipt.candidateWorkspaceHashes,
      p03ReplayReceiptHash: p03Replay.receiptHash, p03HistoricalReceiptHash: receipt.p03HistoricalReceiptHash,
      p03SupersessionRecordHash: receipt.p03SupersessionRecordHash,
      receiptPath: receiptRel, receiptHash: receipt.receiptHash, receiptVerified: true, sealCreatedAt: sealedRun.sealCreatedAt, candidateStartedAt,
      heldoutValuesRevealed: reveal ? sealedRun.challenge : undefined, result: 'CAT_P04_PASS'};
    if (jsonMode) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else process.stdout.write([
      'CAT_CASE=' + result.caseId, 'CAT_CONTRACT=' + result.contractHash, 'CAT_PUBLIC_ORACLE=' + result.publicOracleHash,
      'CAT_HOLDOUT_GENERATOR=' + HOLDOUT_GENERATOR_VERSION, 'CAT_HOLDOUT_SEAL=' + sealedRun.seal, 'CAT_HOLDOUT_COUNT=1',
      'CAT_S2_PUBLIC=' + publicResults.s2.outcome, 'CAT_S2_HOLDOUT=' + holdout.s2.outcome, 'CAT_S2_DECISION=' + decisions.s2,
      'CAT_KNOWN_GOOD_PUBLIC=' + publicResults.good.outcome, 'CAT_KNOWN_GOOD_HOLDOUT=' + holdout.good.outcome, 'CAT_KNOWN_GOOD_DECISION=' + decisions.good,
      'CAT_EQUIVALENT_PUBLIC=' + publicResults.equivalent.outcome, 'CAT_EQUIVALENT_HOLDOUT=' + holdout.equivalent.outcome, 'CAT_EQUIVALENT_DECISION=' + decisions.equivalent,
      'CAT_3_2_1_PUBLIC=' + publicResults.v3.outcome, 'CAT_3_2_1_HOLDOUT=NOT_RUN', 'CAT_3_2_1_DECISION=' + decisions.v3,
      'CAT_PUBLIC_ORACLE_STATUS=' + publicOracleStatus,
      'CAT_HOLDOUT_ACCESS=' + (leakage.privateEvaluatorAccessible ? 'ALLOWED' : 'DENIED'), 'CAT_GIT_ACCESS=' + (leakage.gitMetadataAccessible ? 'ALLOWED' : 'DENIED'),
      'CAT_NETWORK_ACCESS=' + (leakage.outboundNetworkAccessible ? 'ALLOWED' : 'DENIED'), 'CAT_PRIVATE_ENV=' + (leakage.sensitiveEnvironmentNamesPresent ? 'PRESENT' : 'ABSENT'),
      'CAT_P04_PASS', 'CAT_RECEIPT=' + receiptRel, 'CAT_RECEIPT_HASH=' + receipt.receiptHash,
    ].join('\n') + '\n');
    if (reveal) process.stderr.write('CAT_HOLDOUT_REVEAL=' + JSON.stringify(sealedRun.challenge) + '\n');
  } finally {
    rmSync(runDir, {recursive: true, force: true});
    rmSync(path.dirname(sealedRun.artifactPath), {recursive: true, force: true});
  }
}

try { await main(); }
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write((jsonMode ? JSON.stringify({result: 'CAT_P04_BLOCKED', error: message}) : 'CAT_P04_BLOCKED=' + message) + '\n');
  process.exitCode = 1;
}
