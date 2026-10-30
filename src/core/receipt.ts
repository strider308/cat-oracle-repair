import {createHash} from 'node:crypto';
import type {CandidateResult} from './result.ts';

export type AcceptanceReceipt = {
  runId: string;
  createdAt: string;
  baseSha: string;
  candidate: CandidateResult;
  environmentDigest: string;
  sourceHashes: Record<string, string>;
  commands: string[];
  modelIds: string[];
  providerOperationIds: string[];
  knownLimits: string[];
  previousEventHash: string | null;
  receiptHash?: string;
};

function canonicalize(value: unknown, omitReceiptHash = false): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !omitReceiptHash || key !== 'receiptHash')
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalReceiptJson(receipt: AcceptanceReceipt): string {
  return JSON.stringify(canonicalize(receipt, true));
}

export function hashReceipt(receipt: AcceptanceReceipt): string {
  return createHash('sha256').update(canonicalReceiptJson(receipt)).digest('hex');
}

export function finalizeReceipt(receipt: AcceptanceReceipt): AcceptanceReceipt {
  const receiptHash = hashReceipt(receipt);
  return {...receipt, receiptHash};
}

export function verifyReceipt(receipt: AcceptanceReceipt): boolean {
  return typeof receipt.receiptHash === 'string' && receipt.receiptHash === hashReceipt(receipt);
}
