import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {canonical} from '../src/oracle/canonical.ts';

export const GENERATION_AUTHORITY_COMMIT = '5069680ff093695a227bf410eb3de88d99dce9e7';
export const CANDIDATE_ARTIFACT_COMMIT = 'cec8054ba8690172a7b53267cc985a4445b7860b';
const PROFILE_PATH = 'benchmark/protocol/controlled-subject-profile-v1.json';
const SPEC_PATH = 'benchmark/protocol/controlled-mutation-spec-v1.json';
const BUILD_PATH = 'benchmark/protocol/controlled-build-contract-v1.json';
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

function git(root: string, args: string[]) {
  return execFileSync('git', ['-C', root, ...args], {encoding: 'buffer'});
}

function blobAt(root: string, commit: string, filePath: string) {
  return git(root, ['show', `${commit}:${filePath}`]);
}

function assertCommit(root: string, commit: string) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  git(root, ['cat-file', '-e', `${commit}^{commit}`]);
}

export function assertGenerationAuthority(evidence: any) {
  assert.equal(evidence?.freezeCommitSha, GENERATION_AUTHORITY_COMMIT, 'CONTROLLED_GENERATION_AUTHORITY_MISMATCH');
}

export function assertControlledCandidateLifecycle(root: string) {
  assertCommit(root, GENERATION_AUTHORITY_COMMIT);
  assertCommit(root, CANDIDATE_ARTIFACT_COMMIT);
  assert.notEqual(GENERATION_AUTHORITY_COMMIT, CANDIDATE_ARTIFACT_COMMIT);

  const frozenProfileBytes = blobAt(root, GENERATION_AUTHORITY_COMMIT, PROFILE_PATH);
  const artifactProfileBytes = blobAt(root, CANDIDATE_ARTIFACT_COMMIT, PROFILE_PATH);
  assert.deepEqual(artifactProfileBytes, frozenProfileBytes, 'CONTROLLED_PROFILE_CHANGED_AFTER_FREEZE');
  const profile = JSON.parse(frozenProfileBytes.toString('utf8'));
  const bundleRoot = profile.candidateBundleRoot;
  const generationEvidence = JSON.parse(blobAt(root, CANDIDATE_ARTIFACT_COMMIT, `${bundleRoot}/generation-evidence.json`).toString('utf8'));
  const challenge = JSON.parse(blobAt(root, CANDIDATE_ARTIFACT_COMMIT, `${bundleRoot}/challenge-manifest.json`).toString('utf8'));
  const candidate = JSON.parse(blobAt(root, CANDIDATE_ARTIFACT_COMMIT, `${bundleRoot}/manifest.json`).toString('utf8'));
  const buildContract = JSON.parse(blobAt(root, GENERATION_AUTHORITY_COMMIT, BUILD_PATH).toString('utf8'));
  const spec = JSON.parse(blobAt(root, GENERATION_AUTHORITY_COMMIT, SPEC_PATH).toString('utf8'));

  assert.equal(generationEvidence.evidenceVersion, 'ControlledGenerationEvidenceV2');
  assert.equal(challenge.manifestVersion, 'ControlledChallengeManifestV1');
  assert.equal(generationEvidence.reproducibility?.derivationCount, 2);
  assert.equal(generationEvidence.reproducibility?.fullGenerationEquivalent, true);
  assertGenerationAuthority(generationEvidence);
  assert.equal(generationEvidence.profileSha256, sha256(frozenProfileBytes), 'CONTROLLED_GENERATION_PROFILE_BINDING_INVALID');
  assert.equal(generationEvidence.mutationSpecSha256, sha256(blobAt(root, GENERATION_AUTHORITY_COMMIT, SPEC_PATH)), 'CONTROLLED_GENERATION_SPEC_BINDING_INVALID');
  assert.equal(generationEvidence.buildContractSha256, sha256(blobAt(root, GENERATION_AUTHORITY_COMMIT, BUILD_PATH)), 'CONTROLLED_GENERATION_BUILD_BINDING_INVALID');
  const {generationEvidenceSha256, ...generationEvidenceProjection} = generationEvidence;
  assert.equal(generationEvidenceSha256, sha256(Buffer.from(canonical(generationEvidenceProjection))), 'CONTROLLED_GENERATION_EVIDENCE_HASH_INVALID');
  assert.equal(candidate.version, 1, 'CONTROLLED_CANDIDATE_VERSION_INVALID');
  assert.equal(candidate.caseId, profile.caseId, 'CONTROLLED_CANDIDATE_CASE_MISMATCH');
  assert.equal(candidate.candidateId, profile.candidateId, 'CONTROLLED_CANDIDATE_ID_MISMATCH');
  assert.equal(candidate.candidateRoot, profile.candidateRoot, 'CONTROLLED_CANDIDATE_ROOT_MISMATCH');
  assert.equal(candidate.entrypoint, 'index.js', 'CONTROLLED_CANDIDATE_ENTRYPOINT_INVALID');
  assert.equal(candidate.candidateHash, generationEvidence.runtimeCandidateHash, 'CONTROLLED_RUNTIME_HASH_BINDING_INVALID');
  assert.equal(generationEvidence.runtimeManifestSha256, sha256(Buffer.from(canonical(candidate))), 'CONTROLLED_RUNTIME_MANIFEST_BINDING_INVALID');
  assert.equal(generationEvidence.dependencyIdentitySha256, profile.dependencyIdentity.inventorySha256, 'CONTROLLED_DEPENDENCY_BINDING_INVALID');
  assert.equal(generationEvidence.dependencyLockSha256, profile.dependencyIdentity.lockfileSha256, 'CONTROLLED_LOCK_BINDING_INVALID');
  assert.equal(generationEvidence.executionInfrastructureIdentitySha256, profile.controlledExecutionInfrastructureV2.identitySha256,
    'CONTROLLED_EXECUTION_INFRASTRUCTURE_BINDING_INVALID');
  assert.deepEqual(generationEvidence.changedPaths, [spec.sourcePath], 'CONTROLLED_GENERATION_DELTA_INVALID');
  const runtimeRows = candidate.files.map((row: {path: string; sha256: string}) => ({path: row.path, sha256: row.sha256}));
  assert.deepEqual(candidate.files, runtimeRows, 'CONTROLLED_RUNTIME_ROWS_INVALID');
  assert.deepEqual(runtimeRows.map((row: {path: string}) => row.path), buildContract.expectedRuntimeFiles, 'CONTROLLED_RUNTIME_PATHS_INVALID');
  for (const row of runtimeRows) {
    assert.equal(sha256(blobAt(root, CANDIDATE_ARTIFACT_COMMIT, `${profile.candidateRoot}/${row.path}`)), row.sha256,
      `CONTROLLED_RUNTIME_FILE_HASH_MISMATCH:${row.path}`);
  }
  assert.equal(sha256(Buffer.from(canonical(runtimeRows))), candidate.candidateHash, 'CONTROLLED_RUNTIME_INVENTORY_HASH_INVALID');
  assert.equal(challenge.freezeCommitSha, GENERATION_AUTHORITY_COMMIT, 'CONTROLLED_CHALLENGE_AUTHORITY_MISMATCH');
  assert.equal(challenge.challengeId, profile.caseId, 'CONTROLLED_CHALLENGE_ID_MISMATCH');
  assert.equal(challenge.profileSha256, generationEvidence.profileSha256, 'CONTROLLED_CHALLENGE_PROFILE_BINDING_INVALID');
  assert.equal(challenge.mutationSpecSha256, generationEvidence.mutationSpecSha256, 'CONTROLLED_CHALLENGE_SPEC_BINDING_INVALID');
  assert.equal(challenge.buildContractSha256, generationEvidence.buildContractSha256, 'CONTROLLED_CHALLENGE_BUILD_BINDING_INVALID');
  assert.equal(challenge.sourceCandidateHash, generationEvidence.sourceCandidateHash, 'CONTROLLED_CHALLENGE_SOURCE_BINDING_INVALID');
  assert.equal(challenge.runtimeCandidateHash, generationEvidence.runtimeCandidateHash, 'CONTROLLED_CHALLENGE_RUNTIME_BINDING_INVALID');
  assert.equal(challenge.generationEvidenceSha256, generationEvidence.generationEvidenceSha256, 'CONTROLLED_CHALLENGE_EVIDENCE_BINDING_INVALID');
  assert.equal(challenge.baseSourceTreeSha256, profile.base.sourceTreeSha256, 'CONTROLLED_CHALLENGE_BASE_BINDING_INVALID');
  assert.equal(challenge.dependencyIdentitySha256, generationEvidence.dependencyIdentitySha256, 'CONTROLLED_CHALLENGE_DEPENDENCY_BINDING_INVALID');
  assert.equal(challenge.executionInfrastructureIdentitySha256, generationEvidence.executionInfrastructureIdentitySha256,
    'CONTROLLED_CHALLENGE_INFRASTRUCTURE_BINDING_INVALID');
  assert.deepEqual(challenge.changedPaths, [spec.sourcePath], 'CONTROLLED_CHALLENGE_DELTA_INVALID');

  const candidatePaths = [profile.candidateBundleRoot, profile.candidateSourceRoot, profile.candidateRoot,
    profile.reproductionSourceRoot, profile.reproductionRuntimeRoot];
  for (const candidatePath of candidatePaths) {
    assert.throws(() => execFileSync('git', ['-C', root, 'cat-file', '-e', `${GENERATION_AUTHORITY_COMMIT}:${candidatePath}`], {stdio: 'ignore'}),
      `CANDIDATE_PRESENT_IN_GENERATION_AUTHORITY:${candidatePath}`);
    assert.doesNotThrow(() => git(root, ['cat-file', '-e', `${CANDIDATE_ARTIFACT_COMMIT}:${candidatePath}`]),
      `CANDIDATE_MISSING_FROM_ARTIFACT_COMMIT:${candidatePath}`);
  }
  return {generationEvidence};
}
