import {createHash} from 'node:crypto';
import {isNvidiaModel, runTokenFactoryJsonSchemaRequest, selectNvidiaModels, type TokenFactoryModel, type TokenFactoryRequestOptions} from '../runtime/nebius.ts';
import {REPAIR_RESPONSE_SCHEMA, validateRepairProposal} from './model-response.ts';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
export const APPROVED_REPAIR_MODEL_ID = 'nvidia/nemotron-3-super-120b-a12b';
export const MAX_REPAIR_PACKAGE_BYTES = 65_536;

export function selectRepairModel(models: TokenFactoryModel[]): TokenFactoryModel {
  const exact = selectNvidiaModels(models).find((model) => model.id === APPROVED_REPAIR_MODEL_ID);
  if (exact) return exact;
  throw new Error('NO_APPROVED_LIVE_NVIDIA_NEMOTRON_MODEL');
}

export async function requestRepairProposal(input: {apiKey: string; model: string; liveModels: TokenFactoryModel[]; requestPackage: string; baseSha256: string; persistRawResponse?: (bytes: Buffer) => string; persistResponseContent?: (bytes: Buffer) => string; options?: TokenFactoryRequestOptions}) {
  const model = input.liveModels.find((item) => item.id === input.model);
  if (input.model !== APPROVED_REPAIR_MODEL_ID || !model || !model.id.startsWith('nvidia/') || !isNvidiaModel(model)) throw new Error('REPAIR_MODEL_NOT_CURRENTLY_DISCOVERED_NVIDIA');
  if (Buffer.byteLength(input.requestPackage, 'utf8') > MAX_REPAIR_PACKAGE_BYTES) throw new Error('REPAIR_REQUEST_PACKAGE_TOO_LARGE');
  const result = await runTokenFactoryJsonSchemaRequest(input.apiKey, model.id, input.requestPackage, REPAIR_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    {...input.options, retryDns: false});
  const rawResponseSha256 = createHash('sha256').update(result.responseEnvelopeBytes).digest('hex');
  const rawResponseObjectId = input.persistRawResponse?.(result.responseEnvelopeBytes) ?? null;
  const responseContentObjectId = input.persistResponseContent?.(Buffer.from(result.content, 'utf8')) ?? null;
  const validated = validateRepairProposal(result.content, input.baseSha256);
  return {...result, rawResponseSha256, rawResponseObjectId, responseContentObjectId,
    validatedResponseSha256: validated.validatedSha256, proposal: validated.proposal};
}
