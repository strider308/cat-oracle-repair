import {randomBytes, randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {canonical} from '../oracle/canonical.ts';
import {sha256} from './sealed-verifier.ts';

export const HOLDOUT_GENERATOR_VERSION = 'positive-expiry-v1';
export function createHoldout(runId = randomUUID()) {
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('HOLDOUT_RUN_ID_INVALID');
  const seed = randomBytes(32);
  const seedCreatedAt = new Date().toISOString();
  const key = 'p04-' + seed.subarray(0, 8).toString('hex');
  const value = 'v-' + seed.subarray(8, 16).toString('hex');
  const challenge = {key, value, initialTtlSeconds: 15 + seed[16] % 31, updatedTtlSeconds: 15 + seed[17] % 31};
  const challengeId = sha256(canonical(challenge));
  const pack = {runId, generatorVersion: HOLDOUT_GENERATOR_VERSION, challenges: [{...challenge, challengeId}]};
  const bytes = Buffer.from(canonical(pack));
  const privateDir = path.join(os.tmpdir(), 'cat-p04-verifier-' + runId);
  mkdirSync(privateDir, {mode: 0o700});
  const artifactPath = path.join(privateDir, 'holdout.json');
  writeFileSync(artifactPath, bytes, {flag: 'wx', mode: 0o600});
  const seal = sha256(bytes);
  const sealCreatedAt = new Date().toISOString();
  return {challenge: {...challenge, challengeId}, runId, bytes, artifactPath, privateEvidenceId: path.basename(privateDir), seedCreatedAt, seal, sealCreatedAt};
}
