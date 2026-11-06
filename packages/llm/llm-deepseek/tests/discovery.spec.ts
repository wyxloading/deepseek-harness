import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { userAgent } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as ApiKey from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { discoverDeepSeekModels, readModelListing } from '../src/discovery.ts'

// Registered through `ctx.plugin`, which carries no Loader entry id, so the
// api-key plugin falls back to its own name; the shipped bundle names the
// entry `llm-deepseek` and the card is keyed on that namespace.
const NS = 'llm-deepseek-api-key'
const KEY_REF = credentialRef('DEEPSEEK_API_KEY')
const servers: Server[] = []
let testHome: string

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'dsh-deepseek-discovery-'))
  vi.stubEnv('DSH_HOME', testHome)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.close(() => { resolve() })
  })))
  rmSync(testHome, { recursive: true, force: true })
})

interface ListingServer {
  url: string
  paths: string[]
  headers: IncomingMessage['headers'][]
}

/**
 * A stand-in endpoint answering one scripted listing. A chunked behavior writes
 * without a declared length, which is how a streamed reply arrives.
 */
async function listingServer(behavior: {
  status?: number
  body?: string
  chunks?: string[]
  holdOpenMs?: number
}): Promise<ListingServer> {
  const paths: string[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    paths.push(request.url ?? '')
    headers.push(request.headers)
    if (behavior.chunks !== undefined) {
      response.writeHead(behavior.status ?? 200, { 'content-type': 'application/json' })
      for (const chunk of behavior.chunks) response.write(chunk)
      if (behavior.holdOpenMs === undefined) { response.end(); return }
      setTimeout(() => { response.end() }, behavior.holdOpenMs)
      return
    }
    const body = behavior.body ?? '{}'
    response.writeHead(behavior.status ?? 200, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    })
    response.end(body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: 'http://127.0.0.1:' + String(address.port), paths, headers }
}

/** A plugin context whose route resolves the given endpoint. */
async function harness(config: object = {}, credentials = false): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  if (credentials) {
    await ctx.plugin(LocalCredentialProvider, { path: join(testHome, '.credentials.yaml'), watch: false })
  }
  await ctx.plugin(ApiKey, { baseURL: 'http://127.0.0.1:9', ...config })
  return ctx
}

describe('model listing reading', () => {
  it('reads the standard data array, every name and capacity spelling', () => {
    expect(readModelListing({
      data: [
        { id: 'by-name', name: 'By Name', max_input_tokens: 1000, max_tokens: 100 },
        { id: 'by-display-name', display_name: 'By Display Name', context_length: 2000, max_output_tokens: 200 },
        { id: 'by-camel-name', displayName: 'By Camel Name', contextWindow: 3000, maxOutputTokens: 300 },
        { id: 'by-snake', context_window: 4000, max_output_tokens: 400 },
        { id: 'by-limit', limit: { context: 5000, output: 500 } },
        { id: 'bare' },
        { id: 'usable-only', max_input_tokens: 0, max_tokens: -1 },
        { id: 'fractional', max_input_tokens: 1.5, max_tokens: 'many' },
        { id: 'empty-name', name: '' },
        { name: 'no id at all' },
      ],
    })).toEqual([
      { id: 'by-name', name: 'By Name', contextWindow: 1000, maxTokens: 100 },
      { id: 'by-display-name', name: 'By Display Name', contextWindow: 2000, maxTokens: 200 },
      { id: 'by-camel-name', name: 'By Camel Name', contextWindow: 3000, maxTokens: 300 },
      { id: 'by-snake', name: 'by-snake', contextWindow: 4000, maxTokens: 400 },
      { id: 'by-limit', name: 'by-limit', contextWindow: 5000, maxTokens: 500 },
      { id: 'bare', name: 'bare' },
      { id: 'usable-only', name: 'usable-only' },
      { id: 'fractional', name: 'fractional' },
      { id: 'empty-name', name: 'empty-name' },
    ])
  })

  it('reads an enriched models map, using property keys and skipping non-records', () => {
    expect(readModelListing({
      models: {
        'route-key': { display_name: 'Route Key' },
        '': { id: 'nested-id' },
        'malformed-route': null,
        'primitive-route': 'not a model record',
        'array-route': ['not a model record'],
      },
    })).toEqual([
      { id: 'route-key', name: 'Route Key' },
      { id: 'nested-id', name: 'nested-id' },
    ])
  })

  it('prefers the data array when both supported formats are present', () => {
    expect(readModelListing({ data: [{ id: 'standard' }], models: { enriched: { name: 'Enriched' } } }))
      .toEqual([{ id: 'standard', name: 'standard' }])
  })

  it('refuses a body with neither supported listing', () => {
    for (const body of [null, {}, { data: 'not a list' }, { models: null }, { models: 'text' }, { models: [] }]) {
      expect(() => readModelListing(body)).toThrow(/neither a "data" array nor a "models" object/)
    }
  })
})

describe('endpoint interrogation', () => {
  it('sends the resolved credential and reads the advertised models', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [{ id: 'qwen3.8-flash', display_name: 'Qwen 3.8 Flash', max_input_tokens: 1_000_000, max_tokens: 64_000 }],
      }),
    })

    const models = await discoverDeepSeekModels({
      baseURL: server.url + '/',
      resolveApiKey: () => Promise.resolve('probe-key'),
    })

    expect(models).toEqual([
      { id: 'qwen3.8-flash', name: 'Qwen 3.8 Flash', contextWindow: 1_000_000, maxTokens: 64_000 },
    ])
    expect(server.paths).toEqual(['/models'])
    expect(server.headers[0]?.authorization).toBe('Bearer probe-key')
    expect(server.headers[0]?.accept).toBe('application/json')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('probes without a credential when the deployment supplies none', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'open' }] }) })

    const models = await discoverDeepSeekModels({ baseURL: server.url, resolveApiKey: () => Promise.resolve(undefined) })

    expect(models).toEqual([{ id: 'open', name: 'open' }])
    expect(server.headers[0]?.authorization).toBeUndefined()
  })

  it('refuses a key no header can carry before the request goes out', async () => {
    const server = await listingServer({ body: '{}' })
    const source = { baseURL: server.url, resolveApiKey: () => Promise.resolve('bad key') }
    await expect(discoverDeepSeekModels(source)).rejects.toThrow(/characters no HTTP header can carry/)
    await expect(discoverDeepSeekModels({
      baseURL: server.url,
      resolveApiKey: () => Promise.resolve('   '),
    })).rejects.toThrow(/blank API key/)
    expect(server.paths).toEqual([])
  })

  it('reports a refusal, naming the key only when the endpoint blamed it', async () => {
    const unauthorized = await listingServer({ status: 401, body: '{}' })
    await expect(discoverDeepSeekModels({ baseURL: unauthorized.url, resolveApiKey: () => Promise.resolve(undefined) }))
      .rejects.toThrow(/answered 401; check the API key/)

    const failing = await listingServer({ status: 500, body: '{}' })
    await expect(discoverDeepSeekModels({ baseURL: failing.url, resolveApiKey: () => Promise.resolve(undefined) }))
      .rejects.toThrow(/^http.*answered 500$/)
  })

  it('reports a body that is not JSON and an endpoint that cannot be reached', async () => {
    const notJson = await listingServer({ body: 'not json' })
    await expect(discoverDeepSeekModels({ baseURL: notJson.url, resolveApiKey: () => Promise.resolve(undefined) }))
      .rejects.toThrow(/did not answer with JSON/)

    await expect(discoverDeepSeekModels({
      baseURL: 'http://127.0.0.1:9',
      resolveApiKey: () => Promise.resolve(undefined),
    })).rejects.toThrow(/could not reach/)
  })

  it('refuses a declared oversized body without reading it', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(5 * 1024 * 1024) })
      response.end('{}')
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')

    await expect(discoverDeepSeekModels({
      baseURL: 'http://127.0.0.1:' + String(address.port),
      resolveApiKey: () => Promise.resolve(undefined),
    })).rejects.toThrow(/more than 4194304 bytes/)
  })

  it('refuses a streamed body past the ceiling', async () => {
    const chunk = 'x'.repeat(1024 * 1024)
    const server = await listingServer({ chunks: [chunk, chunk, chunk, chunk, chunk] })
    await expect(discoverDeepSeekModels({ baseURL: server.url, resolveApiKey: () => Promise.resolve(undefined) }))
      .rejects.toThrow(/more than 4194304 bytes/)
  })

  it('settles an aborted interrogation as cancelled', async () => {
    const before = new AbortController()
    before.abort()
    await expect(discoverDeepSeekModels(
      { baseURL: 'http://127.0.0.1:9', resolveApiKey: () => Promise.resolve(undefined) },
      before.signal,
    )).rejects.toThrow(/aborted by caller/)

    const server = await listingServer({ chunks: ['{}'], holdOpenMs: 5_000 })
    const during = new AbortController()
    const pending = discoverDeepSeekModels(
      { baseURL: server.url, resolveApiKey: () => Promise.resolve(undefined) },
      during.signal,
    )
    // Wait past the response headers so the cancellation lands while the body
    // is still being read, which is the other abort path.
    await new Promise(resolve => setTimeout(resolve, 50))
    during.abort()
    await expect(pending).rejects.toThrow(/aborted by caller/)
  })
})

describe('registered discovery', () => {
  it('interrogates the endpoint the route resolves when the request names none', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'from-route' }] }) })
    vi.stubEnv('DEEPSEEK_API_KEY', 'env-key')
    const ctx = await harness({ baseURL: server.url })

    expect(await ctx.llm.discoverModels(NS, { provider: 'deepseek-official' }))
      .toEqual([{ id: 'from-route', name: 'from-route' }])
    expect(server.headers[0]?.authorization).toBe('Bearer env-key')
  })

  it('probes unauthenticated when the credential reference is empty', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'open' }] }) })
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const ctx = await harness({ baseURL: server.url })

    expect(await ctx.llm.discoverModels(NS, { provider: 'deepseek-official' }))
      .toEqual([{ id: 'open', name: 'open' }])
    expect(server.headers[0]?.authorization).toBeUndefined()
  })

  it('reads the credential seam when one is mounted', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'stored' }] }) })
    const ctx = await harness({ baseURL: server.url }, true)
    await ctx.get('credentials')?.set(KEY_REF, 'stored-key')

    await ctx.llm.discoverModels(NS, { provider: 'deepseek-official' })

    expect(server.headers[0]?.authorization).toBe('Bearer stored-key')
  })

  it('honors a request endpoint and a one-shot key over the resolved facts', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'draft' }] }) })
    vi.stubEnv('DEEPSEEK_API_KEY', 'env-key')
    const ctx = await harness()

    await ctx.llm.discoverModels(NS, { baseURL: server.url, apiKey: 'typed-key' })

    expect(server.paths).toEqual(['/models'])
    expect(server.headers[0]?.authorization).toBe('Bearer typed-key')
  })
})
