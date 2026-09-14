/**
 * Answering "which models does this endpoint serve?" for the configuration
 * surface's fetch action over the DeepSeek wire dialect.
 *
 * The endpoint is a deployment's own proxy or gateway as often as the public
 * API, so the reply is read as the OpenAI-compatible model listing those
 * gateways serve: a "data" array, or the enriched "models" map some of them
 * publish instead. Nothing here is stored — the reply is candidate metadata a
 * surface offers for adoption, and the settings document remains the only
 * thing that decides what a route serves.
 *
 * @module dsh-llm-deepseek/discovery
 */

import {
  attributionHeaders, INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey,
} from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'

/**
 * Endpoint replies larger than this are refused. The endpoint is whatever URL
 * the deployment configured, so the ceiling holds on the bytes actually read
 * rather than on the length the server claims; a truncated listing is not
 * parseable, so overflow rejects instead of truncating.
 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** One entry of a supported model-listing reply. */
interface ListingEntry {
  id?: unknown
  /** Common gateway extensions; absent from the endpoint's own listing. */
  name?: unknown
  display_name?: unknown
  displayName?: unknown
  contextWindow?: unknown
  context_window?: unknown
  context_length?: unknown
  max_input_tokens?: unknown
  maxOutputTokens?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
  maxTokens?: unknown
  limit?: { context?: unknown; output?: unknown } | null
}

/** A positive integer field of a listing entry, or undefined when absent or unusable. */
function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/** A non-empty string field of a listing entry, or undefined. */
function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * Read one model-listing reply. The standard data array takes precedence when
 * both supported formats are present. An enriched models map uses each
 * property key as the request-facing id; its nested id is only a fallback for
 * an empty key, because a gateway may put a canonical identity there instead
 * of the alias it accepts on requests. Only object-valued map entries are
 * models; primitive properties are directory metadata.
 *
 * Entries without a usable id are skipped rather than failing the whole
 * interrogation: one malformed row must not deny the user the rest of a
 * working endpoint's catalog.
 * @param body - parsed reply body.
 * @returns the advertised models in endpoint order.
 * @throws LlmError with DISCOVERY_FAILED when neither supported format is present.
 */
export function readModelListing(body: unknown): LlmDiscoveredModel[] {
  const listing = body as { data?: unknown; models?: unknown } | null
  const data = listing?.data
  let listed: { readonly key?: string; readonly raw: unknown }[]
  if (Array.isArray(data)) {
    listed = (data as readonly unknown[]).map(raw => ({ raw }))
  } else {
    const models = listing?.models
    if (models === null || typeof models !== 'object' || Array.isArray(models)) {
      throw new LlmError(
        'the model listing has neither a "data" array nor a "models" object',
        'DISCOVERY_FAILED',
      )
    }
    listed = Object.entries(models as Record<string, unknown>)
      .filter(([, raw]) => raw !== null && typeof raw === 'object' && !Array.isArray(raw))
      .map(([key, raw]) => ({ key, raw }))
  }
  const models: LlmDiscoveredModel[] = []
  for (const { key, raw } of listed) {
    const entry = raw as ListingEntry | null
    const id = label(key, entry?.id)
    if (id === undefined) continue
    const name = label(entry?.name, entry?.display_name, entry?.displayName) ?? id
    const contextWindow = capacity(
      entry?.max_input_tokens,
      entry?.contextWindow,
      entry?.context_window,
      entry?.context_length,
      entry?.limit?.context,
    )
    const maxTokens = capacity(
      entry?.max_tokens,
      entry?.maxOutputTokens,
      entry?.max_output_tokens,
      entry?.maxTokens,
      entry?.limit?.output,
    )
    models.push({
      id,
      name,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    })
  }
  return models
}

/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what enforces the bound, because a server
 * that under-declares (or streams) tells us nothing up front.
 * @param response - a successful listing response.
 * @param url - the interrogated URL, named in the refusal.
 * @returns the decoded body.
 * @throws LlmError with DISCOVERY_FAILED past the ceiling.
 */
async function readBounded(response: Response, url: string): Promise<string> {
  const limit = 'answered with more than ' + String(MAX_RESPONSE_BYTES) + ' bytes'
  const oversized = (): LlmError => new LlmError(url + ' ' + limit, 'DISCOVERY_FAILED')
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw oversized()
  }
  /* v8 ignore next -- fetch always exposes a body stream on a 2xx Response; the null guard is defensive. */
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    /* v8 ignore next 4 -- cancel() after a completed or abandoned read settles without rejecting; unobserved best-effort cleanup. */
    await reader.cancel().catch(() => {
      // Cancel after a drained read, or after this function walked away from an
      // oversized one, is cleanup; the reply is already decided either way.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/** Host-owned inputs of one endpoint interrogation. */
export interface DeepSeekDiscoverySource {
  /** Endpoint base; the listing is requested at its /models path. */
  readonly baseURL: string
  /**
   * Resolve the credential to send, or undefined when the deployment supplies
   * none. An endpoint reachable on a private network may answer an
   * unauthenticated listing, so an absent credential probes anyway.
   */
  readonly resolveApiKey: () => Promise<string | undefined>
}

/**
 * Interrogate one DeepSeek-compatible endpoint for the models it advertises.
 * @param source - the endpoint and its credential resolver.
 * @param signal - caller cancellation, honored before and during the body read.
 * @returns the advertised models in endpoint order.
 * @throws LlmError when the endpoint refuses or fails the request, the key
 * cannot be carried in a header, or the reply is not a model listing.
 */
export async function discoverDeepSeekModels(
  source: DeepSeekDiscoverySource,
  signal?: AbortSignal,
): Promise<LlmDiscoveredModel[]> {
  const url = source.baseURL.replace(/[/]+$/, '') + '/models'
  const supplied = await source.resolveApiKey()
  const headers = new Headers()
  headers.set('accept', 'application/json')
  if (supplied !== undefined) {
    const checked = normalizeApiKey(supplied)
    if (!checked.ok) {
      throw new LlmError(
        checked.reason === 'empty'
          ? 'this route has a blank API key; store one on the Models page, or clear it to probe unauthenticated'
          : 'this route has an API key with characters no HTTP header can carry; paste the raw key only',
        INVALID_CREDENTIAL_CODE,
      )
    }
    headers.set('authorization', 'Bearer ' + checked.value)
  }
  for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      ...signal === undefined ? {} : { signal },
    })
  } catch (error: unknown) {
    if (signal?.aborted === true) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError('could not reach ' + url, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    const help = response.status === 401 || response.status === 403 ? '; check the API key' : ''
    throw new LlmError(url + ' answered ' + String(response.status) + help, 'DISCOVERY_FAILED')
  }
  let text: string
  try {
    text = await readBounded(response, url)
  } catch (error: unknown) {
    // Cancellation during the body read rejects with the abort reason, which
    // may be any value; the caller gets the same coded failure it would have
    // for a cancellation before the request went out.
    if (signal?.aborted === true) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw error
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    throw new LlmError(url + ' did not answer with JSON', 'DISCOVERY_FAILED', { cause: error })
  }
  return readModelListing(body)
}
