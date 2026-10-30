import {formatTokenFactoryNetworkDiagnostic, listTokenFactoryModels, resolveTokenFactoryBaseUrl, runTokenFactorySmoke, selectNvidiaModels, TokenFactoryError} from '../src/runtime/nebius.ts';

const apiKey = process.env.NEBIUS_API_KEY ?? '';
const requestedModel = process.env.CAT_NVIDIA_MODEL_ID?.trim() || null;
const timeoutMs = Number(process.env.CAT_PREFLIGHT_TIMEOUT_MS ?? '15000');

if (!apiKey) {
  console.error('TOKEN_FACTORY_AUTH_MISSING');
  process.exitCode = 2;
} else if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) {
  console.error('CAT_SMOKE_BLOCKED: CAT_PREFLIGHT_TIMEOUT_MS must be an integer from 1 to 120000');
  process.exitCode = 2;
} else {
  try {
    const baseUrl = resolveTokenFactoryBaseUrl(process.env.CAT_TOKEN_FACTORY_BASE_URL);
    console.log(`CAT_TOKEN_FACTORY_BASE_URL=${baseUrl}`);
    const discovery = await listTokenFactoryModels(apiKey, {timeoutMs, baseUrl});
    const candidates = selectNvidiaModels(discovery.models);
    const model = requestedModel
      ? candidates.find((candidate) => candidate.id === requestedModel)
      : candidates[0];
    if (!model) throw new Error(requestedModel
      ? 'CAT_NVIDIA_MODEL_ID was not returned as an NVIDIA/Nemotron model'
      : 'No NVIDIA/Nemotron candidate models were returned by Token Factory');

    const result = await runTokenFactorySmoke(apiKey, model.id, {timeoutMs, baseUrl,
      authorizationFile: process.env.CAT_INFERENCE_AUTHORIZATION_FILE,
      operationId: process.env.CAT_INFERENCE_OPERATION_ID,
      accountReference: process.env.CAT_NEBIUS_ACCOUNT_REFERENCE});
    console.log('CAT_SMOKE_PASS');
    console.log(`CAT_DISCOVERY_NETWORK_ATTEMPTS=${discovery.networkAttempts}`);
    console.log(`CAT_DISCOVERY_NETWORK_RECOVERED_CAUSE=${discovery.recoveredNetworkCause ?? 'NONE'}`);
    console.log('CAT_PROVIDER=Nebius');
    console.log('CAT_ENDPOINT_CLASS=chat.completions');
    console.log(`CAT_BASE_ENDPOINT=${baseUrl}`);
    console.log(`CAT_ENDPOINT=${result.endpoint}`);
    console.log(`CAT_MODEL_REQUESTED=${result.modelId}`);
    console.log(`CAT_MODEL_RETURNED=${result.responseModel}`);
    console.log(`CAT_CONTENT_TYPE=${result.contentType ?? 'UNKNOWN'}`);
    console.log(`CAT_REQUEST_ID=${result.requestId ?? 'UNKNOWN'}`);
    console.log(`CAT_FINISH_REASON=${result.finishReason}`);
    console.log(`CAT_OUTPUT_BYTES=${result.outputBytes}`);
    console.log(`CAT_REASONING_PRESENT=${result.reasoningPresent}`);
    console.log(`CAT_REASONING_TYPE=${result.reasoningType}`);
    console.log(`CAT_PROMPT_TOKENS=${result.tokenUsage?.prompt ?? 'UNKNOWN'}`);
    console.log(`CAT_COMPLETION_TOKENS=${result.tokenUsage?.completion ?? 'UNKNOWN'}`);
    console.log(`CAT_TOTAL_TOKENS=${result.tokenUsage?.total ?? 'UNKNOWN'}`);
    console.log(`CAT_LATENCY_MS=${result.latencyMs}`);
    console.log(`CAT_HTTP_STATUS=${result.httpStatus}`);
    console.log(`CAT_NETWORK_ATTEMPTS=${result.networkAttempts}`);
    console.log(`CAT_NETWORK_RECOVERED_CAUSE=${result.recoveredNetworkCause ?? 'NONE'}`);
    console.log('CAT_PROVIDER_REPORTED_COST=UNKNOWN');
  } catch (error) {
    if (error instanceof TokenFactoryError) {
      const networkDiagnostic = formatTokenFactoryNetworkDiagnostic(error, 'CAT_SMOKE');
      if (networkDiagnostic) {
        for (const line of networkDiagnostic) console.error(line);
      } else {
        console.error(`CAT_SMOKE_ERROR: ${error.code}`);
        for (const [key, value] of Object.entries(error.details)) console.error(`CAT_ERROR_${key.toUpperCase()}=${value ?? 'UNKNOWN'}`);
      }
    } else {
      console.error('CAT_SMOKE_ERROR: TOKEN_FACTORY_UNKNOWN_ERROR');
    }
    process.exitCode = 3;
  }
}
