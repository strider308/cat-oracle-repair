import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {consumeInferenceAuthorization} from './inference-authorization.ts';

export const TOKEN_FACTORY_BASE_URL = 'https://api.tokenfactory.nebius.com/v1/';

export type TokenFactoryModel = {
  id: string;
  owned_by?: string;
  name?: string;
};

export type TokenFactorySmokeResult = {
  modelId: string;
  responseModel: string;
  endpoint: string;
  httpStatus: number;
  contentType: string | null;
  requestId: string | null;
  operationId: string | null;
  finishReason: string;
  outputBytes: number;
  reasoningPresent: 'yes' | 'no';
  reasoningType: 'null' | 'string' | 'object' | 'array' | 'other' | 'absent';
  latencyMs: number;
  tokenUsage: {prompt: number; completion: number; total: number} | null;
  cost: number | null;
  networkAttempts: number;
  recoveredNetworkCause: 'ENOTFOUND' | 'EAI_AGAIN' | null;
};

export type TokenFactoryRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  baseUrl?: URL;
  fetchImplementation?: typeof fetch;
  retryDns?: boolean;
  authorizationFile?: string;
  operationId?: string;
  accountReference?: string;
};

type TokenFactoryFetchResult = {
  response: Response;
  networkAttempts: number;
  recoveredNetworkCause: 'ENOTFOUND' | 'EAI_AGAIN' | null;
};

export class TokenFactoryError extends Error {
  readonly code: string;
  readonly details: Record<string, string | number | null>;

  constructor(
    code: string,
    message: string,
    details: Record<string, string | number | null> = {},
  ) {
    super(message);
    this.name = 'TokenFactoryError';
    this.code = code;
    this.details = details;
  }
}

const TOKEN_FACTORY_FAILURE_CODE = /^[A-Z0-9_:-]{1,100}$/;

export function resolveTokenFactoryFailureCode(error: unknown): string {
  if (error instanceof TokenFactoryError && typeof error.code === 'string' && TOKEN_FACTORY_FAILURE_CODE.test(error.code)) {
    return error.code;
  }
  if (error instanceof Error && TOKEN_FACTORY_FAILURE_CODE.test(error.message)) return error.message;
  return 'UNEXPECTED_FAILURE';
}

const TOKEN_FACTORY_REGIONAL_BASE_URL = 'https://api.tokenfactory.us-central1.nebius.com/v1/';
const TOKEN_FACTORY_ALLOWED_BASE_URLS = new Set([
  TOKEN_FACTORY_BASE_URL,
  TOKEN_FACTORY_BASE_URL.slice(0, -1),
  TOKEN_FACTORY_REGIONAL_BASE_URL,
  TOKEN_FACTORY_REGIONAL_BASE_URL.slice(0, -1),
]);

export function resolveTokenFactoryBaseUrl(envValue?: string): URL {
  const configured = envValue ?? TOKEN_FACTORY_BASE_URL;
  const slashCanonical = configured.endsWith('/') ? configured : `${configured}/`;
  if (!TOKEN_FACTORY_ALLOWED_BASE_URLS.has(slashCanonical)) {
    throw new TokenFactoryError('TOKEN_FACTORY_ENDPOINT_INVALID', 'CAT_TOKEN_FACTORY_BASE_URL is not an approved endpoint');
  }

  const url = new URL(slashCanonical);
  if (url.protocol !== 'https:' || !['api.tokenfactory.nebius.com', 'api.tokenfactory.us-central1.nebius.com'].includes(url.hostname) ||
      (url.port !== '' && url.port !== '443') || url.username !== '' || url.password !== '' || url.search !== '' ||
      url.hash !== '' || url.pathname !== '/v1/') {
    throw new TokenFactoryError('TOKEN_FACTORY_ENDPOINT_INVALID', 'CAT_TOKEN_FACTORY_BASE_URL is not an approved endpoint');
  }
  return url;
}

function requestBaseUrl(options: TokenFactoryRequestOptions): URL {
  return resolveTokenFactoryBaseUrl(options.baseUrl?.toString());
}

const NETWORK_ERROR_MESSAGE = 'Token Factory network request failed';
const NETWORK_ERROR_NAMES = new Set(['TypeError', 'Error', 'AbortError', 'DOMException', 'FetchError', 'SystemError']);
const NETWORK_CAUSE_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH',
  'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'ABORT_ERR',
]);
const NETWORK_SYSCALLS = new Set(['getaddrinfo', 'connect', 'read', 'write', 'lookup', 'queryA', 'queryAAAA']);

function safeNetworkField(key: string, value: unknown): string | number | null {
  if (key === 'errorMessage') return NETWORK_ERROR_MESSAGE;
  if (key === 'errorName' || key === 'causeName') {
    return typeof value === 'string' && NETWORK_ERROR_NAMES.has(value) ? value : null;
  }
  if (key === 'causeCode') return typeof value === 'string' && NETWORK_CAUSE_CODES.has(value) ? value : null;
  if (key === 'causeSyscall') return typeof value === 'string' && NETWORK_SYSCALLS.has(value) ? value : null;
  if (key === 'causeHostname') {
    return typeof value === 'string' && (/^api\.tokenfactory(?:\.us-central1)?\.nebius\.com$/i.test(value) || isIP(value) > 0)
      ? value : null;
  }
  if (key === 'causeAddress') return typeof value === 'string' && isIP(value) > 0 ? value : null;
  if (key === 'causePort') return value === 443 || value === '443' ? 443 : null;
  if (key === 'causeErrno') {
    const errno = typeof value === 'number' ? value
      : typeof value === 'string' && /^-?\d{1,10}$/.test(value) ? Number(value) : NaN;
    if (Number.isInteger(errno) && Math.abs(errno) <= 2147483647) return errno;
  }
  return null;
}

export function tokenFactoryNetworkError(error: unknown): TokenFactoryError {
  const source = isRecord(error) ? error : {};
  const cause = isRecord(source.cause) ? source.cause : {};
  const safe = (key: string, value: unknown): string | number | null => safeNetworkField(key, value);
  return new TokenFactoryError('TOKEN_FACTORY_NETWORK_ERROR', NETWORK_ERROR_MESSAGE, {
    errorName: safe('errorName', source.name) ?? 'UNKNOWN',
    errorMessage: NETWORK_ERROR_MESSAGE,
    causeName: safe('causeName', cause.name),
    causeCode: safe('causeCode', cause.code) ?? 'UNKNOWN',
    causeErrno: safe('causeErrno', cause.errno),
    causeSyscall: safe('causeSyscall', cause.syscall),
    causeHostname: safe('causeHostname', cause.hostname),
    causeAddress: safe('causeAddress', cause.address),
    causePort: safe('causePort', cause.port),
  });
}

export function getTokenFactoryFailureDiagnostic(error: unknown) {
  if (!(error instanceof TokenFactoryError) || error.code !== 'TOKEN_FACTORY_NETWORK_ERROR') return null;
  const safe = (key: string): string | number | null => safeNetworkField(key, error.details[key]);
  return {
    code: 'TOKEN_FACTORY_NETWORK_ERROR',
    errorName: safe('errorName'),
    errorMessage: NETWORK_ERROR_MESSAGE,
    causeName: safe('causeName'),
    causeCode: safe('causeCode'),
    causeErrno: safe('causeErrno'),
    causeSyscall: safe('causeSyscall'),
    causeHostname: safe('causeHostname'),
    causeAddress: safe('causeAddress'),
    causePort: safe('causePort'),
  };
}

export function formatTokenFactoryNetworkDiagnostic(error: unknown, prefix: 'CAT_PREFLIGHT' | 'CAT_SMOKE' = 'CAT_PREFLIGHT'): string[] | null {
  const diagnostic = getTokenFactoryFailureDiagnostic(error);
  if (!diagnostic) return null;
  const value = (key: string): string => {
    const field = diagnostic[key as keyof typeof diagnostic];
    return field === null ? 'UNKNOWN' : String(field);
  };
  return [
    `${prefix}_ERROR=TOKEN_FACTORY_NETWORK_ERROR`,
    `${prefix}_ERROR_NAME=${value('errorName')}`,
    `${prefix}_ERROR_MESSAGE=${value('errorMessage')}`,
    `${prefix}_CAUSE_NAME=${value('causeName')}`,
    `${prefix}_CAUSE_CODE=${value('causeCode')}`,
    `${prefix}_CAUSE_ERRNO=${value('causeErrno')}`,
    `${prefix}_CAUSE_SYSCALL=${value('causeSyscall')}`,
    `${prefix}_CAUSE_HOSTNAME=${value('causeHostname')}`,
    `${prefix}_CAUSE_ADDRESS=${value('causeAddress')}`,
    `${prefix}_CAUSE_PORT=${value('causePort')}`,
  ];
}

export function isNvidiaModel(model: TokenFactoryModel): boolean {
  const haystack = `${model.id} ${model.owned_by ?? ''} ${model.name ?? ''}`.toLowerCase();
  return haystack.includes('nvidia') || haystack.includes('nemotron');
}

export function selectNvidiaModels(models: TokenFactoryModel[]): TokenFactoryModel[] {
  return models.filter(isNvidiaModel);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function readJsonBoundedEvidence(response: Response): Promise<{payload: unknown; rawBytes: Buffer}> {
  const reader = response.body?.getReader();
  if (!reader) throw new TokenFactoryError('TOKEN_FACTORY_RESPONSE_NOT_JSON', 'Token Factory response body was empty', {
    status: response.status,
    contentType: response.headers.get('content-type'),
    responseBytes: 0,
    responseSha256: createHash('sha256').update('').digest('hex'),
  });
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024 * 1024) throw new Error('Token Factory response exceeded the 1 MiB limit');
      chunks.push(value);
      text += decoder.decode(value, {stream: true});
    }
    text += decoder.decode();
    return {payload: JSON.parse(text) as unknown, rawBytes: Buffer.concat(chunks)};
  } catch (error) {
    await reader.cancel();
    if (error instanceof SyntaxError) {
      const raw = Buffer.concat(chunks);
      throw new TokenFactoryError('TOKEN_FACTORY_RESPONSE_NOT_JSON', 'Token Factory response was not valid JSON', {
        status: response.status,
        contentType: response.headers.get('content-type'),
        responseBytes: bytes,
        responseSha256: createHash('sha256').update(raw).digest('hex'),
      });
    }
    throw error;
  }
}

export async function readJsonBounded(response: Response): Promise<unknown> {
  return (await readJsonBoundedEvidence(response)).payload;
}

export async function tokenFactoryHttpError(response: Response, apiKey = ''): Promise<TokenFactoryError> {
  const code = response.status === 401 || response.status === 403
    ? 'TOKEN_FACTORY_AUTH_ERROR'
    : response.status === 429
      ? 'TOKEN_FACTORY_RATE_LIMIT'
      : response.status === 404
        ? 'TOKEN_FACTORY_MODEL_UNAVAILABLE'
        : 'TOKEN_FACTORY_HTTP_ERROR';
  let providerError: unknown;
  try {
    providerError = await readJsonBounded(response);
  } catch {
    // HTTP status remains authoritative when an error body is absent or non-JSON.
  }
  const detail = isRecord(providerError) && isRecord(providerError.error) ? providerError.error : providerError;
  const sanitize = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const withoutKey = apiKey ? value.replaceAll(apiKey, '[REDACTED]') : value;
    return withoutKey
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/[\r\n\t]+/g, ' ').slice(0, 300);
  };
  return new TokenFactoryError(code, `${code}: Token Factory returned HTTP ${response.status}`, {
    status: response.status,
    contentType: response.headers.get('content-type'),
    requestId: response.headers.get('x-request-id') ?? response.headers.get('request-id'),
    providerErrorType: isRecord(detail) ? sanitize(detail.type) : null,
    providerErrorCode: isRecord(detail) ? sanitize(detail.code) : null,
    providerMessage: isRecord(detail) ? sanitize(detail.message) : null,
    retryAfter: response.headers.get('retry-after'),
  });
}

export function parseTokenFactoryModels(payload: unknown): TokenFactoryModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('Token Factory models response did not contain a data array');
  }
  return payload.data.map((model) => {
    if (!isRecord(model) || typeof model.id !== 'string' || !model.id.trim()) {
      throw new Error('Token Factory models response contained a malformed model');
    }
    for (const key of ['owned_by', 'name'] as const) {
      if (model[key] !== undefined && typeof model[key] !== 'string') {
        throw new Error('Token Factory models response contained a malformed model');
      }
    }
    return model as TokenFactoryModel;
  });
}

export function parseTokenFactorySmokeResponse(payload: unknown, requestedModel: string): {
  requestId: string;
  responseModel: string;
  finishReason: string;
  outputBytes: number;
  contentType: 'null' | 'string' | 'object' | 'array' | 'other';
  reasoningPresent: 'yes' | 'no';
  reasoningType: TokenFactorySmokeResult['reasoningType'];
  outcome: 'content' | 'refusal';
  tokenUsage: TokenFactorySmokeResult['tokenUsage'];
} {
  if (!isRecord(payload) || typeof payload.id !== 'string' || !payload.id.trim() ||
      typeof payload.model !== 'string' || !payload.model.trim() || !Array.isArray(payload.choices) ||
      payload.choices.length === 0 || !isRecord(payload.choices[0])) {
    throw new TokenFactoryError('TOKEN_FACTORY_RESPONSE_SCHEMA_ERROR', 'Token Factory chat completion envelope was invalid');
  }
  if (payload.model !== requestedModel) {
    throw new TokenFactoryError('TOKEN_FACTORY_MODEL_MISMATCH', 'Token Factory returned an unexplained model ID');
  }
  const choice = payload.choices[0];
  const message = choice.message;
  if (!isRecord(message)) {
    throw new TokenFactoryError('TOKEN_FACTORY_RESPONSE_SCHEMA_ERROR', 'Token Factory choice did not contain a message object');
  }
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : 'UNKNOWN';
  const contentType = getFieldType(message.content);
  const reasoningField = Object.hasOwn(message, 'reasoning')
    ? message.reasoning
    : message.reasoning_content;
  const reasoningPresent = Object.hasOwn(message, 'reasoning') || Object.hasOwn(message, 'reasoning_content');
  const reasoningType = reasoningPresent ? getFieldType(reasoningField) : 'absent';
  // Provider refusal takes precedence; length exhaustion always invalidates completion.
  if (typeof message.refusal === 'string' && message.refusal.trim()) {
    return {
      requestId: payload.id,
      responseModel: payload.model,
      finishReason,
      outputBytes: 0,
      contentType,
      reasoningPresent: reasoningPresent ? 'yes' : 'no',
      reasoningType,
      outcome: 'refusal',
      tokenUsage: parseTokenFactoryUsage(payload.usage),
    };
  }
  if (finishReason === 'length') {
    const usage = parseTokenFactoryUsage(payload.usage);
    throw new TokenFactoryError('TOKEN_FACTORY_OUTPUT_INCOMPLETE', 'Token Factory exhausted the completion token limit', {
      finishReason,
      contentType,
      outputBytes: typeof message.content === 'string' ? Buffer.byteLength(message.content, 'utf8') : 0,
      reasoningPresent: reasoningPresent ? 'yes' : 'no',
      reasoningType,
      promptTokens: usage?.prompt ?? null,
      completionTokens: usage?.completion ?? null,
      totalTokens: usage?.total ?? null,
    });
  }
  if (finishReason !== 'stop') {
    throw new TokenFactoryError('TOKEN_FACTORY_FINISH_REASON_UNSUPPORTED', 'Token Factory returned an unsupported finish reason', {
      finishReason,
    });
  }
  if (typeof message.content !== 'string' || !message.content.trim()) {
    const usage = parseTokenFactoryUsage(payload.usage);
    throw new TokenFactoryError('TOKEN_FACTORY_OUTPUT_EMPTY', `Token Factory returned no usable assistant content (finish_reason=${finishReason})`, {
      finishReason,
      contentType,
      reasoningPresent: reasoningPresent ? 'yes' : 'no',
      reasoningType,
      promptTokens: usage?.prompt ?? null,
      completionTokens: usage?.completion ?? null,
      totalTokens: usage?.total ?? null,
    });
  }
  return {
    requestId: payload.id,
    responseModel: payload.model,
    finishReason,
    outputBytes: Buffer.byteLength(message.content, 'utf8'),
    contentType,
    reasoningPresent: reasoningPresent ? 'yes' : 'no',
    reasoningType,
    outcome: 'content',
    tokenUsage: parseTokenFactoryUsage(payload.usage),
  };
}

function getFieldType(value: unknown): 'null' | 'string' | 'object' | 'array' | 'other' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'object') return 'object';
  return 'other';
}

function parseTokenFactoryUsage(usage: unknown): TokenFactorySmokeResult['tokenUsage'] {
  if (usage === undefined) return null;
  if (!isRecord(usage) || !['prompt_tokens', 'completion_tokens', 'total_tokens'].every((key) =>
    typeof usage[key] === 'number' && Number.isSafeInteger(usage[key]) && (usage[key] as number) >= 0)) {
    return null;
  }
  return {
    prompt: usage.prompt_tokens as number,
    completion: usage.completion_tokens as number,
    total: usage.total_tokens as number,
  };
}

function abortedNetworkError(): TokenFactoryError {
  return tokenFactoryNetworkError({name: 'AbortError', cause: {name: 'AbortError', code: 'ABORT_ERR'}});
}

async function fetchTokenFactory(
  input: RequestInfo | URL,
  init: RequestInit,
  options: TokenFactoryRequestOptions = {},
  authorization?: {purpose: 'repair' | 'smoke'; model: string; packageSha256: string; maxOutputTokens: number},
): Promise<TokenFactoryFetchResult> {
  const fetcher = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15000;
  if (init.method === 'POST') {
    if (!authorization || !options.authorizationFile || typeof init.body !== 'string') throw new TokenFactoryError('INFERENCE_AUTHORIZATION_REQUIRED', 'INFERENCE_AUTHORIZATION_REQUIRED: inference POST requires an approved one-use authorization');
    consumeInferenceAuthorization({operationId: options.operationId ?? '', purpose: authorization.purpose, endpoint: String(input), model: authorization.model,
      body: init.body, packageSha256: authorization.packageSha256, accountReference: options.accountReference ?? '',
      timeoutMs, maxOutputTokens: authorization.maxOutputTokens, maxResponseBytes: 1024 * 1024}, options.authorizationFile);
  }
  const send = () => {
    if (options.signal?.aborted) throw abortedNetworkError();
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    return fetcher(input, {...init, signal, redirect: 'error'});
  };
  try {
    return {response: await send(), networkAttempts: 1, recoveredNetworkCause: null};
  } catch (error) {
    const networkError = error instanceof TokenFactoryError && error.code === 'TOKEN_FACTORY_NETWORK_ERROR'
      ? error : tokenFactoryNetworkError(error);
    if (init.method === 'POST' || options.retryDns === false) throw networkError;
    const cause = networkError.details.causeCode;
    if (cause !== 'ENOTFOUND' && cause !== 'EAI_AGAIN') throw networkError;
    if (options.signal?.aborted) throw abortedNetworkError();
    try {
      await delay(750, undefined, options.signal ? {signal: options.signal} : undefined);
    } catch {
      throw abortedNetworkError();
    }
    if (options.signal?.aborted) throw abortedNetworkError();
    try {
      return {response: await send(), networkAttempts: 2, recoveredNetworkCause: cause};
    } catch (retryError) {
      throw retryError instanceof TokenFactoryError && retryError.code === 'TOKEN_FACTORY_NETWORK_ERROR'
        ? retryError : tokenFactoryNetworkError(retryError);
    }
  }
}

export async function listTokenFactoryModels(apiKey: string, options: TokenFactoryRequestOptions = {}): Promise<{
  models: TokenFactoryModel[];
  networkAttempts: number;
  recoveredNetworkCause: 'ENOTFOUND' | 'EAI_AGAIN' | null;
}> {
  if (!apiKey.trim()) throw new Error('NEBIUS_API_KEY is required');

  const {response, networkAttempts, recoveredNetworkCause} = await fetchTokenFactory(
    new URL('models?verbose=true', requestBaseUrl(options)),
    {method: 'GET', headers: {Accept: 'application/json', Authorization: `Bearer ${apiKey}`}},
    options,
  );

  if (!response.ok) {
    throw await tokenFactoryHttpError(response, apiKey);
  }

  return {models: parseTokenFactoryModels(await readJsonBounded(response)), networkAttempts, recoveredNetworkCause};
}

export async function runTokenFactorySmoke(apiKey: string, modelId: string, options: TokenFactoryRequestOptions = {}): Promise<TokenFactorySmokeResult> {
  if (!apiKey.trim()) throw new Error('NEBIUS_API_KEY is required');
  if (!modelId.trim()) throw new Error('A discovered NVIDIA model ID is required');

  const endpoint = new URL('chat/completions', requestBaseUrl(options)).toString();
  const body = buildTokenFactorySmokeBody(modelId);
  const startedAt = performance.now();
  const {response, networkAttempts, recoveredNetworkCause} = await fetchTokenFactory(endpoint, {
      method: 'POST',
      headers: {Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
      body,
    }, options, {purpose: 'smoke', model: modelId, packageSha256: createHash('sha256').update(body).digest('hex'), maxOutputTokens: 256});
  if (!response.ok) throw await tokenFactoryHttpError(response, apiKey);

  const result = parseTokenFactorySmokeResponse(await readJsonBounded(response), modelId);
  if (result.outcome === 'refusal') {
    throw new TokenFactoryError('TOKEN_FACTORY_REFUSAL', 'Token Factory refused the smoke prompt', {
      finishReason: result.finishReason,
      contentType: result.contentType,
      reasoningPresent: result.reasoningPresent,
      reasoningType: result.reasoningType,
      promptTokens: result.tokenUsage?.prompt ?? null,
      completionTokens: result.tokenUsage?.completion ?? null,
      totalTokens: result.tokenUsage?.total ?? null,
    });
  }
  return {
    modelId,
    responseModel: result.responseModel,
    endpoint,
    httpStatus: response.status,
    contentType: response.headers.get('content-type'),
    requestId: response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? result.requestId,
    operationId: response.headers.get('x-operation-id'),
    finishReason: result.finishReason,
    outputBytes: result.outputBytes,
    reasoningPresent: result.reasoningPresent,
    reasoningType: result.reasoningType,
    latencyMs: Math.round(performance.now() - startedAt),
    tokenUsage: result.tokenUsage,
    cost: null,
    networkAttempts,
    recoveredNetworkCause,
  };
}

export function buildTokenFactorySmokeBody(modelId: string): string {
  return JSON.stringify({
    model: modelId,
    messages: [{role: 'user', content: 'Reply with the single word OK.'}],
    temperature: 0,
    max_tokens: 256,
  });
}

export async function runTokenFactoryJsonSchemaRequest(apiKey: string, modelId: string, prompt: string, schema: Record<string, unknown>, options: TokenFactoryRequestOptions = {}) {
  if (!apiKey.trim()) throw new Error('NEBIUS_API_KEY is required');
  if (!modelId.trim() || !prompt.trim()) throw new Error('A discovered model and repair package are required');
  const endpoint = new URL('chat/completions', requestBaseUrl(options)).toString();
  const startedAt = performance.now();
  const body = buildTokenFactoryRepairBody(modelId, prompt, schema);
  const {response, networkAttempts, recoveredNetworkCause} = await fetchTokenFactory(endpoint, {
    method: 'POST',
    headers: {Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    body,
  }, options, {purpose: 'repair', model: modelId, packageSha256: createHash('sha256').update(prompt).digest('hex'), maxOutputTokens: 12000});
  if (!response.ok) throw await tokenFactoryHttpError(response, apiKey);
  const {payload, rawBytes} = await readJsonBoundedEvidence(response);
  if (!isRecord(payload) || typeof payload.id !== 'string' || !payload.id.trim() || payload.model !== modelId ||
      !Array.isArray(payload.choices) || !isRecord(payload.choices[0]) || !isRecord(payload.choices[0].message)) {
    throw new TokenFactoryError('TOKEN_FACTORY_RESPONSE_SCHEMA_ERROR', 'Token Factory repair envelope was invalid or returned an unexpected model');
  }
  const choice = payload.choices[0];
  const message = choice.message;
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : 'UNKNOWN';
  if (typeof message.refusal === 'string' && message.refusal.trim()) {
    throw new TokenFactoryError('TOKEN_FACTORY_REFUSAL', 'Token Factory refused the repair request', {finishReason});
  }
  if (finishReason === 'length') throw new TokenFactoryError('TOKEN_FACTORY_OUTPUT_INCOMPLETE', 'Token Factory exhausted the repair completion token limit', {finishReason});
  if (finishReason !== 'stop' || typeof message.content !== 'string' || !message.content.trim()) {
    throw new TokenFactoryError('TOKEN_FACTORY_OUTPUT_INVALID', 'Token Factory returned no complete structured repair proposal', {finishReason});
  }
  if (Buffer.byteLength(message.content, 'utf8') > 131072) throw new TokenFactoryError('TOKEN_FACTORY_OUTPUT_TOO_LARGE', 'Token Factory repair response exceeded the limit');
  return {
    content: message.content,
    responseEnvelopeBytes: rawBytes,
    httpEvidence: {
      version: 1,
      endpoint,
      status: response.status,
      requestHeaders: {accept: 'application/json', 'content-type': 'application/json'},
      responseHeaders: {
        contentType: response.headers.get('content-type'),
        xRequestId: response.headers.get('x-request-id'),
        requestId: response.headers.get('request-id'),
        operationId: response.headers.get('x-operation-id'),
      },
      networkAttempts,
      recoveredNetworkCause: recoveredNetworkCause ?? 'NONE',
    },
    returnedModel: payload.model,
    endpoint,
    requestId: response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? payload.id,
    operationId: response.headers.get('x-operation-id'),
    finishReason,
    tokenUsage: parseTokenFactoryUsage(payload.usage),
    latencyMs: Math.round(performance.now() - startedAt),
    networkAttempts,
    recoveredNetworkCause,
  };
}

export function buildTokenFactoryRepairBody(modelId: string, prompt: string, schema: Record<string, unknown>): string {
  return JSON.stringify({
    model: modelId,
    messages: [{role: 'user', content: prompt}],
    temperature: 0,
    max_tokens: 12000,
    response_format: {type: 'json_schema', json_schema: {name: 'cat_repair_proposal', strict: true, schema}},
  });
}

export function buildTokenFactoryObservationBody(modelId: string, prompt: string, schema: Record<string, unknown>): string {
  if (modelId !== 'nvidia/nemotron-3-super-120b-a12b' || !prompt.trim()) throw new Error('TOKEN_FACTORY_OBSERVATION_REQUEST_INVALID');
  return JSON.stringify({
    model: modelId,
    messages: [{role: 'user', content: prompt}],
    temperature: 0,
    max_tokens: 192,
    response_format: {type: 'json_schema', json_schema: {name: 'cat_oracle_observation_proposal', strict: true, schema}},
  });
}
