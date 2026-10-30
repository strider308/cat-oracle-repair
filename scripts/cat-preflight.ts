import {formatTokenFactoryNetworkDiagnostic, listTokenFactoryModels, resolveTokenFactoryBaseUrl, selectNvidiaModels} from '../src/runtime/nebius.ts';

const apiKey = process.env.NEBIUS_API_KEY ?? '';
const requestedModel = process.env.CAT_NVIDIA_MODEL_ID?.trim() || null;
const timeoutMs = Number(process.env.CAT_PREFLIGHT_TIMEOUT_MS ?? '15000');

if (!apiKey) {
  console.error('TOKEN_FACTORY_AUTH_MISSING');
  process.exitCode = 2;
} else if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) {
  console.error('CAT_PREFLIGHT_BLOCKED: CAT_PREFLIGHT_TIMEOUT_MS must be an integer from 1 to 120000');
  process.exitCode = 2;
} else {
  try {
    const baseUrl = resolveTokenFactoryBaseUrl(process.env.CAT_TOKEN_FACTORY_BASE_URL);
    console.log(`CAT_TOKEN_FACTORY_BASE_URL=${baseUrl}`);
    const result = await listTokenFactoryModels(apiKey, {timeoutMs, baseUrl});
    const models = result.models;
    const nvidiaModels = selectNvidiaModels(models);
    console.log(`CAT_NETWORK_ATTEMPTS=${result.networkAttempts}`);
    console.log(`CAT_NETWORK_RECOVERED_CAUSE=${result.recoveredNetworkCause ?? 'NONE'}`);

    if (nvidiaModels.length === 0) {
      console.error('CAT_PREFLIGHT_BLOCKED: no NVIDIA/Nemotron candidate models were returned by Token Factory');
      process.exitCode = 3;
    } else if (requestedModel && !nvidiaModels.some((model) => model.id === requestedModel)) {
      console.error(`CAT_PREFLIGHT_BLOCKED: CAT_NVIDIA_MODEL_ID was not returned as an NVIDIA/Nemotron model: ${requestedModel}`);
      console.error(`CAT_NVIDIA_MODEL_CANDIDATES=${nvidiaModels.map((model) => model.id).join(',')}`);
      process.exitCode = 3;
    } else {
      console.log('CAT_TOKEN_FACTORY_MODELS_PASS');
      console.log(`CAT_NVIDIA_MODEL_CANDIDATES=${nvidiaModels.map((model) => model.id).join(',')}`);
      if (requestedModel) console.log(`CAT_NVIDIA_MODEL_SELECTED=${requestedModel}`);
    }
  } catch (error) {
    const networkDiagnostic = formatTokenFactoryNetworkDiagnostic(error);
    if (networkDiagnostic) {
      for (const line of networkDiagnostic) console.error(line);
    } else {
      const message = error instanceof Error ? error.message : 'Unknown Token Factory preflight error';
      console.error(`CAT_PREFLIGHT_ERROR: ${message}`);
    }
    process.exitCode = 4;
  }
}
