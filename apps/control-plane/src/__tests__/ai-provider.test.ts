import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool, type PoolClient } from 'pg'
import type { VendorCapability } from '@liwan/commercial-contracts'
import { migrate } from '../db.js'
import type { Config } from '../config.js'
import { aiProviderHttp } from '../ai-provider/http.js'
import { syncProviderFile } from '../ai-provider/sync.js'
import { listModels, MODELS_BUDGET_MS, ProviderCallError, TEST_BUDGET_MS, testCompletion, type Fetcher, type ProbeTarget } from '../ai-provider/client.js'
import { addressClass, cleanEndpoint, checkEndpoint, EndpointError, type Resolver } from '../ai-provider/endpoint.js'
import { guardedFetcher } from '../ai-provider/guarded-fetch.js'
import { findPreset, PRESETS } from '../ai-provider/presets.js'

const KEY = 'sk-vendor-secret-0123456789'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const target = (id: string, apiKey: string | null = KEY, baseUrl = findPreset(id)!.base_url ?? 'http://ollama:11434', streamUsage = findPreset(id)!.stream_usage): ProbeTarget => ({ preset: findPreset(id)!, baseUrl, apiKey, streamUsage })
const sse = (...events: unknown[]) => new Response(events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
const CHUNK = { choices: [{ delta: { content: 'ok' } }] }
const USAGE = { choices: [], usage: { prompt_tokens: 9, completion_tokens: 1, total_tokens: 10 } }

type Seen = { url: string; init: RequestInit }
function recorder(answer: (seen: Seen) => Response | Promise<Response>): { fetcher: Fetcher; seen: Seen[] } {
  const seen: Seen[] = []
  return { seen, fetcher: async (url, init) => { const entry = { url, init }; seen.push(entry); return answer(entry) } }
}

describe('provider catalog', () => {
  it('lists the presets of the spec and keeps every non-Anthropic one on a fixed or given OpenAI-style endpoint', () => {
    expect(PRESETS.map(p => p.id)).toEqual(['openai', 'anthropic', 'gemini', 'deepseek', 'mistral', 'groq', 'xai', 'together', 'openrouter', 'ollama', 'custom'])
    expect(findPreset('anthropic')).toMatchObject({ provider: 'anthropic', needs_api_key: true })
    expect(findPreset('gemini')!.base_url).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
    for (const preset of PRESETS) expect(preset.needs_base_url).toBe(preset.base_url === null)
    expect(PRESETS.filter(p => p.needs_base_url).map(p => p.id)).toEqual(['ollama', 'custom'])
    expect(findPreset('ollama')).toMatchObject({ provider: 'ollama', needs_api_key: false })
  })
  it('puts OpenAI, OpenRouter and Anthropic on their named providers and every other hosted preset on the generic one', () => {
    expect(PRESETS.filter(p => p.named).map(p => [p.id, p.provider])).toEqual([['openai', 'openai'], ['anthropic', 'anthropic'], ['openrouter', 'openrouter']])
    expect(PRESETS.filter(p => p.provider === 'openai_compatible').map(p => p.id)).toEqual(['gemini', 'deepseek', 'mistral', 'groq', 'xai', 'together', 'custom'])
  })
  it('asks every hosted preset for token counts, leaves Ollama and a custom endpoint off, and lets the vendor tick only the custom one', () => {
    expect(PRESETS.filter(p => p.stream_usage).map(p => p.id)).toEqual(['openai', 'anthropic', 'gemini', 'deepseek', 'mistral', 'groq', 'xai', 'together', 'openrouter'])
    expect(PRESETS.filter(p => p.stream_usage_editable).map(p => p.id)).toEqual(['custom'])
    expect(findPreset('ollama')).toMatchObject({ stream_usage: false, stream_usage_editable: false })
  })
})

/** A pooled client whose queries pass through `hook`, on a wrapper: the real client is untouched when it goes back to the pool. */
function withQueryHook(client: PoolClient, hook: (sql: unknown, run: () => Promise<unknown>) => Promise<unknown>): PoolClient {
  return new Proxy(client, {
    get: (target, property) => property === 'query'
      ? (sql: unknown, ...rest: unknown[]) => hook(sql, () => (target.query as (...args: unknown[]) => Promise<unknown>)(sql, ...rest))
      : (target as unknown as Record<string | symbol, unknown>)[property] instanceof Function ? ((target as unknown as Record<string | symbol, (...a: unknown[]) => unknown>)[property] as (...a: unknown[]) => unknown).bind(target) : (target as unknown as Record<string | symbol, unknown>)[property],
  })
}

const PUBLIC = { allowPrivate: false }
const PRIVATE_OK = { allowPrivate: true }
const nameResolver = (answers: Record<string, string[]>): Resolver => async host => { if (!(host in answers)) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); return answers[host]! }

describe('endpoints', () => {
  it('accepts public https URLs without credentials and drops trailing slashes; plain http only for the private-allowed preset', () => {
    expect(cleanEndpoint('https://llm.example.com/v1/', PUBLIC)).toBe('https://llm.example.com/v1')
    expect(cleanEndpoint('http://ollama:11434', PRIVATE_OK)).toBe('http://ollama:11434')
    expect(() => cleanEndpoint('http://llm.example.com/v1', PUBLIC)).toThrow(EndpointError)
  })
  it.each([
    'ftp://x.example/v1', 'https://u:p@x.example/v1', 'https://x.example/v1?key=1', 'https://x.example/v1#a', 'not a url', 'https://',
  ])('refuses the malformed endpoint %s', (url) => {
    expect(() => cleanEndpoint(url, PUBLIC)).toThrow(EndpointError)
    expect(() => cleanEndpoint(url, PRIVATE_OK)).toThrow(EndpointError)
  })
  it.each([
    'https://169.254.169.254/latest', 'https://[::ffff:169.254.169.254]/latest', 'https://[::ffff:a9fe:a9fe]/', 'https://localhost/v1', 'https://app.localhost/v1',
    'https://0.0.0.0/v1', 'https://[::]/v1', 'https://127.0.0.1/v1', 'https://2130706433/v1', 'https://0x7f.1/v1', 'https://[::1]/v1', 'https://[::ffff:127.0.0.1]/v1',
    'https://10.1.2.3/v1', 'https://172.16.0.9/v1', 'https://172.31.255.255/v1', 'https://192.168.0.5/v1', 'https://100.64.0.1/v1', 'https://100.100.100.200/v1',
    'https://[fe80::1]/v1', 'https://[fc00::1]/v1', 'https://[fd12:3456::1]/v1', 'https://[fd00:ec2::254]/latest', 'https://[::ffff:10.0.0.1]/v1',
    'https://[64:ff9b::a9fe:a9fe]/v1', 'https://[2002:a9fe:a9fe::]/v1', 'https://metadata.google.internal/v1', 'https://metadata.google.internal./v1',
    'https://instance-data/latest', 'https://llm/v1', 'https://db.internal/v1', 'https://printer.local/v1',
  ])('refuses the address or name %s for every preset but Ollama', (url) => {
    expect(() => cleanEndpoint(url, PUBLIC)).toThrow(EndpointError)
  })
  it('lets the Ollama preset use private and loopback hosts but still never link-local, unspecified, multicast or metadata', () => {
    for (const url of ['http://10.1.2.3:11434', 'http://192.168.1.9:11434', 'http://127.0.0.1:11434', 'http://localhost:11434', 'http://[::1]:11434', 'http://[fd12::1]:11434', 'http://ollama.internal:11434', 'http://100.64.0.2:11434']) {
      expect(() => cleanEndpoint(url, PRIVATE_OK), url).not.toThrow()
    }
    for (const url of ['http://169.254.169.254', 'http://[::ffff:169.254.169.254]', 'http://[fe80::1]', 'http://0.0.0.0', 'http://[::]', 'http://224.0.0.1', 'http://[fd00:ec2::254]', 'http://100.100.100.200', 'http://metadata.google.internal', 'http://[64:ff9b::a9fe:a9fe]']) {
      expect(() => cleanEndpoint(url, PRIVATE_OK), url).toThrow(EndpointError)
    }
  })
  it('refuses a public endpoint on any port but 443, because ai-egress opens only 443 for a published host, and says so with its own code', () => {
    for (const url of ['https://provider.example:8443/v1', 'https://provider.example:444/v1', 'https://93.184.216.34:8443/v1']) {
      expect(() => cleanEndpoint(url, PUBLIC), url).toThrow(expect.objectContaining({ code: 'base_url_port' }))
    }
    expect(cleanEndpoint('https://provider.example:443/v1', PUBLIC)).toBe('https://provider.example/v1')
    expect(() => cleanEndpoint('https://10.0.0.1:8443/v1', PUBLIC)).toThrow(expect.objectContaining({ code: 'base_url' }))  // a forbidden address is reported as such first
    expect(cleanEndpoint('http://ollama:11434', PRIVATE_OK)).toBe('http://ollama:11434')  // the Ollama preset keeps its own port rule
    expect(cleanEndpoint('https://ollama.example:8443/v1', PRIVATE_OK)).toBe('https://ollama.example:8443/v1')
  })
  it('classifies addresses, judging IPv4 carried in IPv6 as that IPv4 address', () => {
    expect(addressClass('93.184.216.34')).toBe('public')
    expect(addressClass('2606:2800:220:1:248:1893:25c8:1946')).toBe('public')
    expect(addressClass('::ffff:93.184.216.34')).toBe('public')
    expect(addressClass('::ffff:10.0.0.1')).toBe('private')
    expect(addressClass('::ffff:169.254.169.254')).toBe('forbidden')
    expect(addressClass('not-an-address')).toBe('forbidden')
  })
  it('refuses a name that resolves to a forbidden address now, with a stubbed resolver (169.254.169.254.nip.io, any one bad answer among good ones)', async () => {
    const resolve = nameResolver({
      '169.254.169.254.nip.io': ['169.254.169.254'], 'mixed.example.com': ['93.184.216.34', '10.0.0.7'], 'six.example.com': ['::ffff:169.254.169.254'],
      'ula.example.com': ['fd00:ec2::254'], 'fine.example.com': ['93.184.216.34'], 'internal.example.com': ['10.0.0.7'],
    })
    for (const host of ['169.254.169.254.nip.io', 'mixed.example.com', 'six.example.com', 'ula.example.com', 'internal.example.com']) {
      await expect(checkEndpoint(`https://${host}/v1`, PUBLIC, resolve), host).rejects.toThrow(EndpointError)
    }
    await expect(checkEndpoint('https://fine.example.com/v1', PUBLIC, resolve)).resolves.toBe('https://fine.example.com/v1')
    await expect(checkEndpoint('https://internal.example.com/v1', PRIVATE_OK, resolve)).resolves.toBe('https://internal.example.com/v1')
    await expect(checkEndpoint('https://169.254.169.254.nip.io/v1', PRIVATE_OK, resolve)).rejects.toThrow(EndpointError)
    await expect(checkEndpoint('https://unresolvable.example.com/v1', PUBLIC, resolve)).resolves.toBe('https://unresolvable.example.com/v1')  // left to the connection
  })
})

describe('the guarded connection', () => {
  let server: Server
  let port: number
  let big = false
  beforeAll(async () => {
    server = createServer((request, reply) => {
      if (request.url === '/redirect') { reply.writeHead(302, { location: 'http://169.254.169.254/latest' }); return reply.end() }
      reply.writeHead(200, { 'content-type': 'application/json' })
      reply.end(big ? 'x'.repeat(2 * 1024 * 1024) : JSON.stringify({ seen: request.headers.host, auth: request.headers.authorization ?? null }))
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => { server.close() })
  const get = (fetcher: ReturnType<typeof guardedFetcher>, url: string) => fetcher(url, { method: 'GET', headers: { authorization: `Bearer ${KEY}` } })

  it('refuses at connect time every name that resolves to a loopback, private, link-local or metadata address, and never sends the key there', async () => {
    const resolve = nameResolver({
      'llm.example.com': ['127.0.0.1'], '169.254.169.254.nip.io': ['169.254.169.254'], 'mapped.example.com': ['::ffff:169.254.169.254'],
      'ula.example.com': ['fd00:ec2::254'], 'mixed.example.com': ['93.184.216.34', '127.0.0.1'],
    })
    const fetcher = guardedFetcher(PUBLIC, { resolve })
    for (const host of ['llm.example.com', '169.254.169.254.nip.io', 'mapped.example.com', 'ula.example.com', 'mixed.example.com']) {
      await expect(get(fetcher, `http://${host}:${port}/`), host).rejects.toMatchObject({ name: 'EndpointRefused' })
    }
  })
  it('refuses IP literals before any request is made', async () => {
    const fetcher = guardedFetcher(PRIVATE_OK, { resolve: nameResolver({}) })
    for (const url of ['http://169.254.169.254/', 'http://[::ffff:169.254.169.254]/', 'http://0.0.0.0:1/', 'http://[fd00:ec2::254]/']) await expect(get(fetcher, url), url).rejects.toMatchObject({ name: 'EndpointRefused' })
    await expect(get(guardedFetcher(PUBLIC), `http://127.0.0.1:${port}/`)).rejects.toMatchObject({ name: 'EndpointRefused' })
    await expect(get(guardedFetcher(PUBLIC), 'http://[::1]:1/')).rejects.toMatchObject({ name: 'EndpointRefused' })
  })
  it('checks again at every connection, so a name that answers public once and private next cannot pass (DNS rebinding)', async () => {
    let calls = 0
    const rebinding: Resolver = async () => (++calls === 1 ? ['93.184.216.34'] : ['127.0.0.1'])
    const fetcher = guardedFetcher(PUBLIC, { resolve: rebinding })
    // The first answer is public, so the guard lets it through to the connect (cut short here: nothing listens on the public address).
    await fetcher(`http://rebind.example.com:${port}/`, { method: 'GET', signal: AbortSignal.timeout(300) }).catch(() => undefined)
    expect(calls).toBe(1)
    await expect(get(fetcher, `http://rebind.example.com:${port}/`)).rejects.toMatchObject({ name: 'EndpointRefused' })
    expect(calls).toBeGreaterThanOrEqual(2)
  })
  it('connects to exactly the address it checked, and lets the Ollama policy reach a private one', async () => {
    const reply = await get(guardedFetcher(PRIVATE_OK, { resolve: nameResolver({ 'ollama.example.com': ['127.0.0.1'] }) }), `http://ollama.example.com:${port}/`)
    expect(reply.status).toBe(200)
    expect(await reply.json()).toEqual({ seen: `ollama.example.com:${port}`, auth: `Bearer ${KEY}` })
  })
  it('does not follow a redirect, so the key never reaches the host it points to', async () => {
    const reply = await get(guardedFetcher(PRIVATE_OK, { resolve: nameResolver({ 'ollama.example.com': ['127.0.0.1'] }) }), `http://ollama.example.com:${port}/redirect`)
    expect(reply.status).toBe(302)
  })
  it('caps what it reads at 1 MB (and at the limit it is given) instead of buffering a hostile reply', async () => {
    big = true
    try {
      const resolve = nameResolver({ 'ollama.example.com': ['127.0.0.1'] })
      await expect(get(guardedFetcher(PRIVATE_OK, { resolve }), `http://ollama.example.com:${port}/`)).rejects.toMatchObject({ name: 'BodyTooLarge' })
      expect((await get(guardedFetcher(PRIVATE_OK, { resolve, maxBytes: 3 * 1024 * 1024 }), `http://ollama.example.com:${port}/`)).status).toBe(200)
      await expect(listModels(guardedFetcher(PRIVATE_OK, { resolve }), target('ollama', null, `http://ollama.example.com:${port}`))).rejects.toMatchObject({ code: 'invalid_response' })
    } finally { big = false }
  })
  it('turns a refused connection into the stable code endpoint_refused', async () => {
    const fetcher = guardedFetcher(PUBLIC, { resolve: nameResolver({ 'llm.example.com': ['10.0.0.8'] }) })
    await expect(listModels(fetcher, target('custom', KEY, 'http://llm.example.com'))).rejects.toMatchObject({ code: 'endpoint_refused' })
    await expect(testCompletion(fetcher, target('custom', KEY, 'http://llm.example.com'), 'm')).rejects.toMatchObject({ code: 'endpoint_refused' })
  })
})

describe('probe budgets', () => {
  it('stays at 15 s for the models list and two 20 s asks for a test, which the vendor-admin BFF timeouts must exceed', () => {
    expect([MODELS_BUDGET_MS, TEST_BUDGET_MS]).toEqual([15_000, 40_000])
  })
})

describe('listing models', () => {
  it('reads OpenAI-style answers, strips the Gemini prefix, accepts a bare array and sends the key as a bearer token', async () => {
    const { fetcher, seen } = recorder(({ url }) => url.includes('together')
      ? json([{ id: 'meta/llama' }, { id: 'a/b' }])
      : json({ data: [{ id: 'models/gemini-2.0-flash' }, { id: 'models/gemini-2.0-flash' }, { id: 'models/gemini-pro' }, { nope: 1 }] }))
    expect(await listModels(fetcher, target('gemini'))).toEqual(['gemini-2.0-flash', 'gemini-pro'])
    expect(await listModels(fetcher, target('together'))).toEqual(['a/b', 'meta/llama'])
    expect(seen[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/models')
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    expect(seen[0]!.init.redirect).toBe('error')
  })
  it('uses Anthropic and Ollama their own way', async () => {
    const anthropic = recorder(() => json({ data: [{ id: 'claude-sonnet-4-5' }] }))
    expect(await listModels(anthropic.fetcher, target('anthropic'))).toEqual(['claude-sonnet-4-5'])
    expect(anthropic.seen[0]!.url).toBe('https://api.anthropic.com/v1/models?limit=100')
    expect(anthropic.seen[0]!.init.headers).toMatchObject({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01' })
    const ollama = recorder(() => json({ models: [{ name: 'qwen2.5:7b' }, { name: 'bge-m3' }] }))
    expect(await listModels(ollama.fetcher, target('ollama', null))).toEqual(['bge-m3', 'qwen2.5:7b'])
    expect(ollama.seen[0]!.url).toBe('http://ollama:11434/api/tags')
    expect((ollama.seen[0]!.init.headers as Record<string, string>).authorization).toBeUndefined()
  })
  it.each([
    [401, 'unauthorized'], [403, 'unauthorized'], [429, 'rate_limited'], [500, 'provider_error'], [404, 'provider_error'],
  ])('maps HTTP %i to the stable code %s', async (status, code) => {
    const { fetcher } = recorder(() => json({ error: { message: `bad key ${KEY}` } }, status))
    await expect(listModels(fetcher, target('openai'))).rejects.toMatchObject({ code })
  })
  it('reports an unreachable provider, a timeout and an unreadable answer without the key or the provider message', async () => {
    const refuse = (name: string): Fetcher => async () => { throw Object.assign(new Error(`connect failed for ${KEY}`), { name }) }
    await expect(listModels(refuse('TypeError'), target('openai'))).rejects.toMatchObject({ code: 'unreachable', message: 'unreachable' })
    await expect(listModels(refuse('TimeoutError'), target('openai'))).rejects.toMatchObject({ code: 'timeout' })
    await expect(listModels(async () => new Response('<html>', { status: 200 }), target('openai'))).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(listModels(async () => json({ something: 1 }), target('openai'))).rejects.toMatchObject({ code: 'invalid_response' })
  })
})

describe('testing a connection', () => {
  it('streams one tiny completion asking for the usage chunk like the service, and reports the round trip and the token counts', async () => {
    let clock = 1000
    const now = () => (clock += 250)
    const openai = recorder(() => sse(CHUNK, USAGE, '[DONE]'))
    expect(await testCompletion(openai.fetcher, target('deepseek'), 'deepseek-chat', now)).toEqual({ latencyMs: 250, usageReported: true })
    expect(openai.seen[0]!.url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(JSON.parse(openai.seen[0]!.init.body as string)).toMatchObject({ model: 'deepseek-chat', max_tokens: 16, stream: true, stream_options: { include_usage: true } })
    const anthropic = recorder(() => json({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 9, output_tokens: 1 } }))
    expect((await testCompletion(anthropic.fetcher, target('anthropic'), 'claude-x')).usageReported).toBe(true)
    expect(anthropic.seen[0]!.url).toBe('https://api.anthropic.com/v1/messages')
    expect(JSON.parse(anthropic.seen[0]!.init.body as string)).toMatchObject({ model: 'claude-x', max_tokens: 16 })
    const ollama = recorder(() => json({ message: { content: 'ok' }, prompt_eval_count: 9, eval_count: 1 }))
    expect((await testCompletion(ollama.fetcher, target('ollama', null), 'qwen2.5:7b')).usageReported).toBe(true)
    expect(ollama.seen[0]!.url).toBe('http://ollama:11434/api/chat')
    expect(JSON.parse(ollama.seen[0]!.init.body as string)).toMatchObject({ stream: false, options: { num_predict: 16 } })
  })
  it('does not send stream_options when the endpoint is not asked for token counts, and says the reply carried none', async () => {
    const { fetcher, seen } = recorder(() => sse(CHUNK, '[DONE]'))
    expect((await testCompletion(fetcher, target('custom', KEY, 'https://llm.example.com/v1'), 'm')).usageReported).toBe(false)
    expect(JSON.parse(seen[0]!.init.body as string)).not.toHaveProperty('stream_options')
  })
  it('warns (usageReported false) when a provider accepts the request but sends no counts, or counts that are not numbers', async () => {
    expect((await testCompletion(async () => sse(CHUNK, { choices: [], usage: null }, '[DONE]'), target('together'), 'm')).usageReported).toBe(false)
    expect((await testCompletion(async () => sse(CHUNK, { choices: [], usage: { prompt_tokens: null, completion_tokens: 1 } }), target('together'), 'm')).usageReported).toBe(false)
    expect((await testCompletion(async () => sse(CHUNK, { choices: [], usage: { prompt_tokens: 3 } }), target('together'), 'm')).usageReported).toBe(false)
    expect((await testCompletion(async () => json({ content: [] }), target('anthropic'), 'm')).usageReported).toBe(false)
    expect((await testCompletion(async () => json({ message: {} }), target('ollama', null), 'm')).usageReported).toBe(false)
  })
  it('reads a plain JSON reply from a server that ignored stream, and refuses a body that is neither', async () => {
    expect((await testCompletion(async () => json({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } }), target('groq'), 'm')).usageReported).toBe(true)
    await expect(testCompletion(async () => new Response('<html>', { status: 200 }), target('groq'), 'm')).rejects.toMatchObject({ code: 'invalid_response' })
  })
  it('names a provider that refuses stream_options so the vendor can switch the option off', async () => {
    const refuse = async () => new Response('{"error":{"message":"Unknown field: stream_options"}}', { status: 400 })
    await expect(testCompletion(refuse, target('custom', KEY, 'https://llm.example.com/v1', true), 'm')).rejects.toMatchObject({ code: 'stream_usage_refused' })
  })
  it('asks again with max_completion_tokens when a newer model refuses max_tokens', async () => {
    const { fetcher, seen } = recorder(({ init }) => JSON.parse(init.body as string).max_tokens
      ? json({ error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } }, 400)
      : sse(CHUNK, USAGE))
    expect((await testCompletion(fetcher, target('openai'), 'gpt-5')).usageReported).toBe(true)
    expect(seen.map(s => Object.keys(JSON.parse(s.init.body as string)).filter(k => k.includes('tokens')))).toEqual([['max_tokens'], ['max_completion_tokens']])
  })
  it.each([
    [401, '{}', 'unauthorized'], [429, '{}', 'rate_limited'], [503, '{}', 'provider_error'], [404, '{}', 'model_not_found'],
    [400, '{"error":"The model `x` does not exist"}', 'model_not_found'], [400, '{"error":"messages is required"}', 'bad_request'],
  ])('maps HTTP %i %s to %s', async (status, text, code) => {
    await expect(testCompletion(async () => new Response(text, { status }), target('groq'), 'x')).rejects.toMatchObject({ code })
  })
  it('never lets the key or the provider message into an error', async () => {
    const error = await testCompletion(async () => new Response(`key ${KEY} rejected`, { status: 401 }), target('groq'), 'x').catch(e => e)
    expect(error).toBeInstanceOf(ProviderCallError)
    expect(`${error.message}${JSON.stringify(error)}${error.stack}`).not.toContain(KEY)
  })
})

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url && new URL(url).pathname !== '/liwan_control_scratch_aiprovider') throw new Error('AI provider tests require their own scratch DB')
const suite = url ? describe : describe.skip
const SECRET = Buffer.from('a'.repeat(48))

suite('live PostgreSQL platform provider routes', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  let dir: string
  let config: Config
  const auth = (capabilities: VendorCapability[] = ['vendor.read', 'vendor.ai.manage'], extra: Partial<{ stepUpFresh: boolean; method: string }> = {}) =>
    ({ actor: 7, capabilities, stepUpFresh: true, method: 'GET', ...extra })
  const requireCapability = (a: ReturnType<typeof auth>, capability: VendorCapability) => {
    if (!a.capabilities.includes(capability)) throw new Error('forbidden')
    if (a.method !== 'GET' && !a.stepUpFresh) throw new Error('step_up_required')
  }
  const fail = (status: number, code: string) => Object.assign(new Error(code), { status, code })
  async function call(method: string, path: string, body?: unknown, options: { fetch?: Fetcher; resolve?: Resolver; auth?: ReturnType<typeof auth>; config?: Config; pool?: Pool } = {}) {
    const a = options.auth ?? auth(undefined, { method })
    try {
      const r = await aiProviderHttp(options.pool ?? pool, options.config ?? config, { method, pathname: `/v1/platform/ai-provider${path}`, raw: body === undefined ? '' : JSON.stringify(body), auth: a, requireCapability, fail }, { fetch: options.fetch, resolve: options.resolve })
      return { status: r!.status, body: r!.data as any }
    } catch (e) { const c = e as { status?: number; code?: string; message: string }; if (c.status) return { status: c.status, body: { code: c.code } as any }; throw e }
  }
  const providerFile = () => join(dir, 'platform-provider.json')
  const fileJson = async () => JSON.parse(await readFile(providerFile(), 'utf8'))
  const withUsage = () => recorder(() => sse(CHUNK, USAGE, '[DONE]'))

  /** A configuration with one OpenAI provider and one priced model, `routes` as given. */
  const config1 = (routes: object = {}, over: object = {}) => ({
    margin_bps: 2000, providers: { oai: { preset: 'openai', api_key: KEY } },
    models: { mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.5', output_price: '10' } }, routes, reason: 'Set up the platform provider', ...over,
  })
  /** Saves the configuration unrouted, tests its model so the service may charge for it, then saves it routed: returns the second answer. */
  async function routedSave(routes: object = { default: 'mid' }, over: object = {}, options: Parameters<typeof call>[3] = {}) {
    const draft = await call('PATCH', '', config1({}, over), options)
    expect(draft.status).toBe(200)
    expect((await call('POST', '/test', { provider: 'oai', model: 'gpt-4o' }, { fetch: withUsage().fetcher })).body).toMatchObject({ ok: true, usage_reported: true })
    return call('PATCH', '', config1(routes, { providers: { oai: { preset: 'openai' } }, ...over }), options)
  }

  beforeAll(async () => { await migrate(pool) })
  afterAll(async () => { await pool.end() })
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ai-provider-'))
    config = { admin: { secretKey: SECRET, rpId: 'localhost', origin: 'http://localhost', rpName: 'LiwanOS' }, aiPlatformProviderPath: providerFile() } as unknown as Config
    await pool.query('TRUNCATE ai_route, ai_model, ai_provider, ai_provider_config')
    await pool.query("DELETE FROM audit_events WHERE action LIKE 'ai.platform_provider.%'")
  })

  it('answers nothing outside its resource, needs the operations capability for every route and refuses unknown methods', async () => {
    expect(await aiProviderHttp(pool, config, { method: 'GET', pathname: '/v1/tenants', raw: '', auth: auth(), requireCapability, fail })).toBeNull()
    await expect(call('GET', '/presets', undefined, { auth: auth(['vendor.read'], { method: 'GET' }) })).rejects.toThrow('forbidden')
    // The operations capability is not enough: the AI provider has its own, which only the owner role holds.
    for (const [method, path] of [['GET', ''], ['PATCH', ''], ['GET', '/presets'], ['POST', '/models'], ['POST', '/test']] as const) {
      await expect(call(method, path, method === 'GET' ? undefined : {}, { auth: auth(['vendor.read', 'vendor.operations.run', 'vendor.accounts.manage'], { method }) }), `${method} ${path}`).rejects.toThrow('forbidden')
    }
    await expect(call('PATCH', '', config1(), { auth: auth(undefined, { method: 'PATCH', stepUpFresh: false }) })).rejects.toThrow('step_up_required')
    expect((await call('DELETE', '')).status).toBe(404)
    expect((await call('GET', '/models')).status).toBe(404)
  })

  it('lists the presets without any key field and reports no setting before the first save', async () => {
    const presets = await call('GET', '/presets')
    expect(presets.body.total).toBe(11)
    expect(presets.body.items[0]).toEqual({ id: 'openai', label: 'OpenAI', provider: 'openai', base_url: 'https://api.openai.com/v1', needs_base_url: false, needs_api_key: true, stream_usage: true, stream_usage_editable: false })
    expect(presets.body.items.at(-1)).toMatchObject({ id: 'custom', stream_usage: false, stream_usage_editable: true })
    expect(JSON.stringify(presets.body)).not.toContain('dialect')
    expect(JSON.stringify(presets.body)).not.toContain('named')
    expect((await call('GET', '')).body).toEqual({ setting: null })
  })

  it('saves a draft with write-only keys: sealed at rest, last four in the answer, no file until a default model is routed, the save audited with counts and no key', async () => {
    const saved = await call('PATCH', '', config1())
    expect(saved.status).toBe(200)
    expect(saved.body.setting).toMatchObject({
      revision: 1, margin_bps: 2000, updated_by: 'account:7', delivery: 'incomplete', routes: {},
      providers: { oai: { preset: 'openai', provider: 'openai', base_url: null, stream_usage: true, key: { configured: true, last4: '6789' } } },
      models: { mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.5', cached_input_price: null, output_price: '10', usage_reported: false } },
    })
    expect(JSON.stringify(saved.body)).not.toContain(KEY)
    await expect(readFile(providerFile(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const row = (await pool.query('SELECT api_key_sealed FROM ai_provider')).rows[0]
    expect(row.api_key_sealed.toString('utf8')).not.toContain(KEY)
    expect(JSON.stringify((await call('GET', '')).body)).not.toContain(KEY)
    const audit = (await pool.query("SELECT actor, subject, reason, metadata FROM audit_events WHERE action='ai.platform_provider.saved'")).rows
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor: 'account:7', subject: 'platform-ai-provider', reason: 'Set up the platform provider' })
    expect(audit[0].metadata).toEqual({ revision: 1, margin_bps: 2000, providers: 1, models: 1, routes: 0, key_changed: true, keys_changed: 1, delivered: false, complete: false })
    expect(JSON.stringify(audit)).not.toContain(KEY)
  })

  it('routes a model for charged use only when it is priced and its last test saw token counts, and writes the file for the service when a default is routed', async () => {
    await call('PATCH', '', config1())
    expect((await call('PATCH', '', config1({ default: 'mid' }, { providers: { oai: { preset: 'openai' } } }))).body.code).toBe('model_not_tested')
    const unpriced = { models: { mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.5' } } }
    expect((await call('PATCH', '', config1({ default: 'mid' }, { ...unpriced, providers: { oai: { preset: 'openai' } } }))).body.code).toBe('model_not_priced')
    expect((await call('PATCH', '', config1({ default: 'ghost' }))).body.code).toBe('unknown_model')
    expect((await call('PATCH', '', config1({}, { models: { mid: { provider: 'nope', model: 'gpt-4o' } } }))).body.code).toBe('unknown_provider')
    expect((await call('GET', '')).body.setting.revision).toBe(1)  // nothing above changed anything
    // A test that saw no token counts leaves the model unroutable.
    const silent = recorder(() => sse(CHUNK, '[DONE]'))
    expect((await call('POST', '/test', { provider: 'oai', model: 'gpt-4o' }, { fetch: silent.fetcher })).body).toMatchObject({ ok: true, usage_reported: false })
    expect((await call('PATCH', '', config1({ default: 'mid' }, { providers: { oai: { preset: 'openai' } } }))).body.code).toBe('model_not_tested')
    expect((await call('POST', '/test', { provider: 'oai', model: 'gpt-4o' }, { fetch: withUsage().fetcher })).body).toMatchObject({ usage_reported: true })
    const routed = await call('PATCH', '', config1({ default: 'mid' }, { providers: { oai: { preset: 'openai' } } }))
    expect(routed.status).toBe(200)
    expect(routed.body.setting).toMatchObject({ revision: 2, delivery: 'delivered', routes: { default: 'mid' }, models: { mid: { usage_reported: true } } })
    expect(await fileJson()).toEqual({
      revision: 2, margin_bps: 2000,
      providers: { oai: { provider: 'openai', api_key: KEY, stream_usage: true } },
      models: { mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.5', output_price: '10' } },
      routes: { default: 'mid' },
    })
    expect((await stat(providerFile())).mode & 0o777).toBe(0o640)
    const audit = (await pool.query("SELECT metadata FROM audit_events WHERE action='ai.platform_provider.saved' ORDER BY created_at DESC, id LIMIT 1")).rows[0]
    expect(audit.metadata).toMatchObject({ revision: 2, routes: 1, key_changed: false, keys_changed: 0, delivered: true, complete: true })
  })

  it('writes several providers, models and quality columns, only the providers and models some route uses, with prices as plain decimals', async () => {
    const body = {
      margin_bps: 1500,
      providers: { oai: { preset: 'openai', api_key: KEY }, ds: { preset: 'deepseek', api_key: `${KEY}-2` }, idle: { preset: 'groq', api_key: `${KEY}-3` } },
      models: {
        mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.50', cached_input_price: '1.25', output_price: '10.00000' },
        cheap: { provider: 'ds', model: 'deepseek-chat', input_price: '0.14', output_price: '0.28' },
        spare: { provider: 'idle', model: 'llama', input_price: '0.05', output_price: '0.08' },
      },
      routes: {}, reason: 'Two providers and a map',
    }
    await call('PATCH', '', body)
    for (const [provider, model] of [['oai', 'gpt-4o'], ['ds', 'deepseek-chat']]) await call('POST', '/test', { provider, model }, { fetch: withUsage().fetcher })
    const routes = { default: 'mid', balanced: { quick: 'cheap' }, economical: { standard: 'cheap', analysis: 'cheap' }, best: {} }
    const stripped = { ...body, providers: Object.fromEntries(Object.entries(body.providers).map(([id, p]) => [id, { preset: p.preset }])) }
    const saved = await call('PATCH', '', { ...stripped, routes })
    expect(saved.body.setting).toMatchObject({ delivery: 'delivered', routes: { default: 'mid', balanced: { quick: 'cheap' }, economical: { standard: 'cheap', analysis: 'cheap' } } })
    expect(saved.body.setting.models.mid).toMatchObject({ input_price: '2.5', cached_input_price: '1.25', output_price: '10' })
    expect(await fileJson()).toEqual({
      revision: 2, margin_bps: 1500,
      providers: { oai: { provider: 'openai', api_key: KEY, stream_usage: true }, ds: { provider: 'openai_compatible', base_url: 'https://api.deepseek.com/v1', api_key: `${KEY}-2`, stream_usage: true } },
      models: { mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.5', cached_input_price: '1.25', output_price: '10' }, cheap: { provider: 'ds', model: 'deepseek-chat', input_price: '0.14', output_price: '0.28' } },
      routes: { default: 'mid', balanced: { quick: 'cheap' }, economical: { standard: 'cheap', analysis: 'cheap' } },
    })
  })

  it('keeps a stored key while its preset and endpoint stay, asks for a key when they change, and drops a test result when the model or its provider changes', async () => {
    await routedSave()
    const again = await call('PATCH', '', config1({ default: 'mid' }, { providers: { oai: { preset: 'openai' } }, margin_bps: 1000 }))
    expect(again.body.setting).toMatchObject({ margin_bps: 1000, revision: 3, providers: { oai: { key: { configured: true, last4: '6789' } } } })
    expect((await fileJson())).toMatchObject({ providers: { oai: { api_key: KEY } }, revision: 3 })
    const other = await call('PATCH', '', config1({ default: 'mid' }, { providers: { oai: { preset: 'xai' } } }))
    expect(other).toEqual({ status: 422, body: { code: 'api_key_required' } })
    const renamed = await call('PATCH', '', config1({ default: 'mid' }, { providers: { oai: { preset: 'openai' } }, models: { mid: { provider: 'oai', model: 'gpt-4o-mini', input_price: '2.5', output_price: '10' } } }))
    expect(renamed.body.code).toBe('model_not_tested')  // another model name was never tested
    expect((await call('GET', '')).body.setting.revision).toBe(3)
    const extra = await call('PATCH', '', config1({ default: 'mid' }, { providers: { oai: { preset: 'openai' } }, models: { mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.5', output_price: '10' }, other: { provider: 'oai', model: 'gpt-4o-mini' } } }))
    expect(extra.body.setting.models).toMatchObject({ mid: { usage_reported: true }, other: { usage_reported: false } })  // the tested model keeps its result, the new one has none
  })

  it('stores a self-hosted endpoint without a key, and refuses what a preset cannot take', async () => {
    const ollama = await call('PATCH', '', { margin_bps: 0, providers: { local: { preset: 'ollama', base_url: 'http://ollama:11434/' } }, models: { q: { provider: 'local', model: 'qwen2.5:7b' } }, routes: {}, reason: 'Self-hosted model' })
    expect(ollama.body.setting.providers.local).toMatchObject({ provider: 'ollama', base_url: 'http://ollama:11434', stream_usage: false, key: { configured: false, last4: null } })
    const reasons = (extra: object) => call('PATCH', '', { margin_bps: 0, providers: { p: extra }, models: {}, routes: {}, reason: 'Checking' })
    expect((await reasons({ preset: 'ollama' })).body.code).toBe('invalid_base_url')
    expect((await reasons({ preset: 'ollama', base_url: 'https://u:p@h.example' })).body.code).toBe('invalid_base_url')
    expect((await reasons({ preset: 'ollama', base_url: 'http://ollama:11434', api_key: KEY })).body.code).toBe('api_key_not_allowed')
    expect((await reasons({ preset: 'openai', api_key: KEY, base_url: 'https://elsewhere.example/v1' })).body.code).toBe('invalid_base_url')
    expect((await reasons({ preset: 'nope', api_key: KEY })).body.code).toBe('invalid_preset')
    expect((await reasons({ preset: 'custom', api_key: KEY, base_url: 'https://llm.example.com/v1' })).status).toBe(200)
  })

  it('writes the named providers without an endpoint and with their own token-count rule', async () => {
    const base = { margin_bps: 0, models: { m: { provider: 'p', model: 'x', input_price: '1', output_price: '2' } }, reason: 'Named providers' }
    for (const [preset, model] of [['openai', 'gpt-4o'], ['anthropic', 'claude-sonnet-4-5'], ['openrouter', 'anthropic/claude-sonnet-4.5']] as const) {
      await pool.query('TRUNCATE ai_route, ai_model, ai_provider, ai_provider_config')  // each preset starts from nothing
      expect((await call('PATCH', '', { ...base, providers: { p: { preset, api_key: KEY } }, models: { m: { provider: 'p', model, input_price: '1', output_price: '2' } }, routes: {} })).status).toBe(200)
      const counts = preset === 'anthropic' ? recorder(() => sse({ usage: { input_tokens: 9, output_tokens: 1 } })) : withUsage()
      await call('POST', '/test', { provider: 'p', model }, { fetch: counts.fetcher })
      const routed = await call('PATCH', '', { ...base, providers: { p: { preset, api_key: KEY } }, models: { m: { provider: 'p', model, input_price: '1', output_price: '2' } }, routes: { default: 'm' } })
      expect(routed.status, preset).toBe(200)
      const written = (await fileJson()).providers.p
      expect(written).not.toHaveProperty('base_url')
      if (preset === 'anthropic') expect(written).toEqual({ provider: 'anthropic', api_key: KEY })  // reports counts on its own
      else expect(written).toMatchObject({ provider: preset, stream_usage: true })
    }
  })

  it('lets the vendor tick the token-count option of a custom endpoint only, keeps it across saves, and refuses a contradiction of a fixed preset', async () => {
    const custom = { preset: 'custom', api_key: KEY, base_url: 'https://llm.example.com/v1' }
    const body = (provider: object) => ({ margin_bps: 0, providers: { c: provider }, models: { m: { provider: 'c', model: 'm', input_price: '1', output_price: '1' } }, routes: {}, reason: 'Custom endpoint' })
    expect((await call('PATCH', '', body(custom))).body.setting.providers.c.stream_usage).toBe(false)
    expect((await call('PATCH', '', body({ ...custom, stream_usage: true }))).body.setting.providers.c.stream_usage).toBe(true)
    const kept = await call('PATCH', '', body({ preset: 'custom', base_url: 'https://llm.example.com/v1' }))
    expect(kept.body.setting.providers.c.stream_usage).toBe(true)
    expect((await call('PATCH', '', body({ preset: 'groq', api_key: KEY, stream_usage: false }))).body.code).toBe('invalid_stream_usage')
    expect((await call('PATCH', '', body({ preset: 'groq', api_key: KEY, stream_usage: true }))).status).toBe(200)
  })

  it('asks the stream for token counts as the saved option says, and records what the reply carried', async () => {
    const custom = { margin_bps: 0, providers: { c: { preset: 'custom', api_key: KEY, base_url: 'https://llm.example.com/v1' } }, models: { m: { provider: 'c', model: 'm' } }, routes: {}, reason: 'Custom endpoint' }
    await call('PATCH', '', custom)
    const without = recorder(() => sse(CHUNK, '[DONE]'))
    expect((await call('POST', '/test', { provider: 'c', model: 'm' }, { fetch: without.fetcher })).body).toMatchObject({ ok: true, usage_reported: false })
    expect(JSON.parse(without.seen[0]!.init.body as string)).not.toHaveProperty('stream_options')
    await call('PATCH', '', { ...custom, providers: { c: { preset: 'custom', base_url: 'https://llm.example.com/v1', stream_usage: true } } })
    const asked = withUsage()
    expect((await call('POST', '/test', { provider: 'c', model: 'm' }, { fetch: asked.fetcher })).body).toMatchObject({ ok: true, usage_reported: true })
    expect(JSON.parse(asked.seen[0]!.init.body as string)).toMatchObject({ stream: true, stream_options: { include_usage: true } })
    expect((await call('GET', '')).body.setting.models.m.usage_reported).toBe(true)
    const refuses: Fetcher = async () => new Response('stream_options is not supported', { status: 400 })
    expect((await call('POST', '/test', { provider: 'c', model: 'm' }, { fetch: refuses })).body).toEqual({ ok: false, code: 'stream_usage_refused' })
    expect((await call('GET', '')).body.setting.models.m.usage_reported).toBe(true)  // a failed test changes nothing
    // Changing what the stream is asked for makes the earlier result stale.
    await call('PATCH', '', { ...custom, providers: { c: { preset: 'custom', base_url: 'https://llm.example.com/v1', stream_usage: false } } })
    expect((await call('GET', '')).body.setting.models.m.usage_reported).toBe(false)
  })

  it('rolls the whole save back when the file cannot be written, and reports a stale file as pending', async () => {
    await routedSave()
    const broken = { ...config, aiPlatformProviderPath: join(dir, 'missing-dir', 'platform-provider.json') } as Config
    const failed = await call('PATCH', '', config1({ default: 'mid' }, { providers: { oai: { preset: 'openai' } }, margin_bps: 999 }), { config: broken })
    expect(failed).toEqual({ status: 503, body: { code: 'provider_file_unavailable' } })
    expect((await call('GET', '')).body.setting).toMatchObject({ revision: 2, margin_bps: 2000 })
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='ai.platform_provider.saved'")).rowCount).toBe(2)
    await writeFile(providerFile(), JSON.stringify({ revision: 0 }))
    expect((await call('GET', '')).body.setting.delivery).toBe('pending')
    expect((await call('GET', '', undefined, { config: { ...config, aiPlatformProviderPath: undefined } as Config })).body.setting.delivery).toBe('unconfigured')
  })

  it('writes the audit entry before the file and the file last, right before COMMIT, and restores the previous file when COMMIT fails', async () => {
    await routedSave()
    const before = await readFile(providerFile(), 'utf8')
    const order: string[] = []
    const failing: Pool = {
      query: pool.query.bind(pool),
      connect: async () => withQueryHook(await pool.connect(), async (sql, run) => {
        if (typeof sql === 'string' && sql.startsWith('INSERT INTO audit_events')) order.push(`audit (file already new: ${(await readFile(providerFile(), 'utf8')) !== before})`)
        if (sql === 'COMMIT') { order.push(`commit (file already new: ${(await readFile(providerFile(), 'utf8')) !== before})`); throw new Error('commit failed') }
        return run()
      }),
    } as unknown as Pool
    await expect(call('PATCH', '', config1({ default: 'mid' }, { providers: { oai: { preset: 'openai' } }, margin_bps: 777 }), { pool: failing })).rejects.toThrow('commit failed')
    expect(order).toEqual(['audit (file already new: false)', 'commit (file already new: true)'])
    expect(await readFile(providerFile(), 'utf8')).toBe(before)  // the previous content is back
    expect((await call('GET', '')).body.setting).toMatchObject({ margin_bps: 2000, revision: 2 })
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='ai.platform_provider.saved'")).rowCount).toBe(2)
  })

  it('removes the file again when the first routed save fails at COMMIT, and sweeps temporary files a crashed write left behind', async () => {
    await call('PATCH', '', config1())
    await call('POST', '/test', { provider: 'oai', model: 'gpt-4o' }, { fetch: withUsage().fetcher })
    const failing: Pool = { query: pool.query.bind(pool), connect: async () => withQueryHook(await pool.connect(), async (sql, run) => { if (sql === 'COMMIT') throw new Error('commit failed'); return run() }) } as unknown as Pool
    await writeFile(join(dir, '.platform-provider.crashed.tmp'), '{"api_key":"left over"}')
    const routed = config1({ default: 'mid' }, { providers: { oai: { preset: 'openai' } } })
    await expect(call('PATCH', '', routed, { pool: failing })).rejects.toThrow('commit failed')
    await expect(readFile(providerFile(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(dir)).toEqual([])  // the stale temporary file is gone too
    await writeFile(join(dir, '.platform-provider.crashed2.tmp'), 'x')
    await writeFile(join(dir, 'unrelated.txt'), 'keep')
    await call('PATCH', '', routed)
    expect((await readdir(dir)).sort()).toEqual(['platform-provider.json', 'unrelated.txt'])
  })

  it('audits every models and test call with the provider, the preset, the host and the outcome, and never the key', async () => {
    const reply = recorder(({ url: u }) => (u.endsWith('/models') ? json({ data: [{ id: 'm1' }] }) : sse(CHUNK, USAGE)))
    await call('PATCH', '', {
      margin_bps: 0, reason: 'Providers to probe', routes: {}, models: {},
      providers: { g: { preset: 'groq', api_key: KEY }, d: { preset: 'deepseek', api_key: KEY }, x: { preset: 'custom', base_url: 'https://llm.example.com/v1', api_key: KEY } },
    })
    await call('POST', '/models', { provider: 'g' }, { fetch: reply.fetcher })
    await call('POST', '/test', { provider: 'g', model: 'm1' }, { fetch: reply.fetcher })
    await call('POST', '/test', { provider: 'd', model: 'm1' }, { fetch: async () => new Response('no', { status: 401 }) })
    await call('POST', '/test', { provider: 'x', model: 'm1' }, { fetch: reply.fetcher })
    await call('POST', '/models', { provider: 'x' }, { resolve: async () => ['169.254.169.254'] })
    const rows = (await pool.query("SELECT action, subject, reason, actor, metadata FROM audit_events WHERE action IN ('ai.platform_provider.models_listed','ai.platform_provider.tested') ORDER BY created_at, id")).rows
    expect(rows.map(r => [r.action.split('.').pop(), r.metadata])).toEqual([
      ['models_listed', { provider: 'g', preset: 'groq', host: 'api.groq.com', outcome: 'ok' }],
      ['tested', { provider: 'g', preset: 'groq', host: 'api.groq.com', model: 'm1', outcome: 'ok' }],
      ['tested', { provider: 'd', preset: 'deepseek', host: 'api.deepseek.com', model: 'm1', outcome: 'unauthorized' }],
      ['tested', { provider: 'x', preset: 'custom', host: 'llm.example.com', model: 'm1', outcome: 'ok' }],
      ['models_listed', { provider: 'x', preset: 'custom', host: 'llm.example.com', outcome: 'invalid_base_url' }],
    ])
    expect(rows.every(r => r.subject === 'platform-ai-provider' && r.actor === 'account:7')).toBe(true)
    expect(JSON.stringify(rows)).not.toContain(KEY)
  })

  it('refuses a custom endpoint that is, or resolves to, an internal address, in save, and again in models and test if the name has moved, but lets Ollama reach a private host', async () => {
    const internal = { 'internal.example.com': ['10.0.0.9'], '169.254.169.254.nip.io': ['169.254.169.254'] }
    const resolve: Resolver = async host => { if (host in internal) return internal[host as keyof typeof internal]; return ['93.184.216.34'] }
    for (const base_url of ['https://169.254.169.254.nip.io/v1', 'https://internal.example.com/v1', 'https://[::ffff:169.254.169.254]/v1', 'https://localhost/v1', 'https://0.0.0.0/v1', 'https://[fd00:ec2::254]/v1', 'http://llm.example.com/v1']) {
      const saved = await call('PATCH', '', { margin_bps: 0, providers: { c: { preset: 'custom', base_url, api_key: KEY } }, models: {}, routes: {}, reason: 'Custom endpoint' }, { resolve })
      expect(saved.body.code, base_url).toBe('invalid_base_url')
    }
    expect((await call('GET', '')).body).toEqual({ setting: null })
    const save = (base_url: string) => call('PATCH', '', { margin_bps: 0, providers: { local: { preset: 'ollama', base_url } }, models: {}, routes: {}, reason: 'Internal Ollama' }, { resolve })
    expect((await save('http://10.0.0.5:11434')).status).toBe(200)
    expect((await save('http://169.254.169.254')).body.code).toBe('invalid_base_url')
    const ok = recorder(() => json({ models: [{ name: 'qwen' }] }))
    expect((await call('POST', '/models', { provider: 'local' }, { fetch: ok.fetcher, resolve })).body.items).toEqual([{ id: 'qwen' }])
    // A saved public name that later resolves to an internal address is refused when it is used.
    await call('PATCH', '', { margin_bps: 0, providers: { c: { preset: 'custom', base_url: 'https://llm.example.com/v1', api_key: KEY } }, models: {}, routes: {}, reason: 'Custom endpoint' }, { resolve })
    const moved: Resolver = async () => ['10.0.0.9']
    expect((await call('POST', '/models', { provider: 'c' }, { resolve: moved })).body.code).toBe('invalid_base_url')
    expect((await call('POST', '/test', { provider: 'c', model: 'm' }, { resolve: moved })).body.code).toBe('invalid_base_url')
  })

  it('refuses a custom endpoint on a non-443 port in save with the stable code invalid_base_url_port, but not Ollama on its port', async () => {
    const resolve: Resolver = async () => ['93.184.216.34']
    const body = (provider: object) => ({ margin_bps: 0, providers: { c: provider }, models: {}, routes: {}, reason: 'Odd port' })
    const custom = { preset: 'custom', base_url: 'https://provider.example:8443/v1', api_key: KEY }
    expect((await call('PATCH', '', body(custom), { resolve })).body.code).toBe('invalid_base_url_port')
    expect((await call('GET', '')).body).toEqual({ setting: null })
    expect((await call('PATCH', '', body({ ...custom, base_url: 'https://provider.example:443/v1' }), { resolve })).body.setting.providers.c.base_url).toBe('https://provider.example/v1')
    expect((await call('PATCH', '', body({ preset: 'ollama', base_url: 'http://10.0.0.5:11434' }), { resolve })).status).toBe(200)
  })

  it('holds the save lock until a failed save has restored the file, so a waiting save is not overwritten by the late restore', async () => {
    await routedSave()
    const first = await readFile(providerFile(), 'utf8')
    const again = (margin_bps: number) => config1({ default: 'mid' }, { providers: { oai: { preset: 'openai' } }, margin_bps })
    let reachedCommit!: () => void
    const atCommit = new Promise<void>((resolve) => { reachedCommit = resolve })
    let failCommit!: () => void
    const gate = new Promise<void>((resolve) => { failCommit = resolve })
    const failing: Pool = { query: pool.query.bind(pool), connect: async () => withQueryHook(await pool.connect(), async (sql, run) => {
      if (sql === 'COMMIT') { reachedCommit(); await gate; throw new Error('commit failed') }
      if (sql === 'ROLLBACK') { const done = await run(); await new Promise(resolve => setTimeout(resolve, 400)); return done }  // widen the window between the rollback and the restore
      return run()
    }) } as unknown as Pool
    const loser = call('PATCH', '', again(1111), { pool: failing })
    const loserOutcome = loser.then(() => 'saved', (error: Error) => error.message)
    await atCommit
    expect(await readFile(providerFile(), 'utf8')).not.toBe(first)  // the losing save's file is in place, its COMMIT pending
    let winnerDone = false
    const winner = call('PATCH', '', again(2222)).then((result) => { winnerDone = true; return result })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(winnerDone).toBe(false)  // the winner waits: the lock is not the transaction's, it outlives the rollback
    failCommit()
    expect(await loserOutcome).toBe('commit failed')
    const won = await winner
    expect(won.body.setting).toMatchObject({ margin_bps: 2222, revision: 3 })
    expect(await fileJson()).toMatchObject({ margin_bps: 2222, revision: 3 })  // not the loser's restored content
    expect((await call('GET', '')).body.setting).toMatchObject({ margin_bps: 2222, revision: 3, delivery: 'delivered' })
  })

  it('needs the control plane secret to take a key', async () => {
    const noSecret = { ...config, admin: undefined } as Config
    expect((await call('PATCH', '', config1(), { config: noSecret })).body.code).toBe('secret_key_unavailable')
  })

  it('answers a models or test call for a provider that is not saved with unknown_provider', async () => {
    const { fetcher, seen } = recorder(() => json({ data: [] }))
    expect((await call('POST', '/models', { provider: 'oai' }, { fetch: fetcher })).body.code).toBe('unknown_provider')
    expect((await call('POST', '/test', { provider: 'oai', model: 'gpt-4o' }, { fetch: fetcher })).body.code).toBe('unknown_provider')
    expect(seen).toEqual([])
  })

  it('tests with the stored key, reports a missing one without calling out, and an unreadable key as unavailable', async () => {
    const { fetcher, seen } = recorder(({ url: u }) => u.endsWith('/models') ? json({ data: [{ id: 'm1' }] }) : sse(CHUNK))
    await call('PATCH', '', { margin_bps: 0, providers: { oai: { preset: 'openai', api_key: KEY }, ollama: { preset: 'ollama', base_url: 'http://ollama:11434' } }, models: {}, routes: {}, reason: 'Providers' })
    const listed = await call('POST', '/models', { provider: 'oai' }, { fetch: fetcher })
    expect(listed.body).toEqual({ items: [{ id: 'm1' }], total: 1 })
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    expect((await call('POST', '/test', { provider: 'oai', model: 'gpt-4o' }, { fetch: fetcher })).body).toEqual({ ok: true, latency_ms: expect.any(Number), usage_reported: false })
    expect((seen[1]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    expect((await call('POST', '/test', { provider: 'ollama', model: 'qwen' }, { fetch: fetcher })).body).toMatchObject({ ok: true })
    // A provider row without a sealed key (a preset that needs one) is answered without any call.
    await pool.query("UPDATE ai_provider SET api_key_sealed=NULL, api_key_last4=NULL WHERE id='oai'")
    seen.length = 0
    expect((await call('POST', '/test', { provider: 'oai', model: 'gpt-4o' }, { fetch: fetcher })).body).toEqual({ ok: false, code: 'key_missing' })
    expect((await call('POST', '/models', { provider: 'oai' }, { fetch: fetcher })).body.code).toBe('api_key_required')
    expect(seen).toEqual([])
  })

  it('answers a failing test with a stable code only, and a failing model list with a coded error', async () => {
    await call('PATCH', '', { margin_bps: 0, providers: { oai: { preset: 'openai', api_key: KEY } }, models: {}, routes: {}, reason: 'Providers' })
    const unauthorized: Fetcher = async () => new Response(`bad key ${KEY}`, { status: 401 })
    const test = await call('POST', '/test', { provider: 'oai', model: 'gpt-4o' }, { fetch: unauthorized })
    expect(test).toEqual({ status: 200, body: { ok: false, code: 'unauthorized' } })
    expect((await call('POST', '/models', { provider: 'oai' }, { fetch: unauthorized })).body.code).toBe('provider_unauthorized')
    const down: Fetcher = async () => { throw new TypeError(`fetch failed for ${KEY}`) }
    expect((await call('POST', '/models', { provider: 'oai' }, { fetch: down })).body.code).toBe('provider_unreachable')
    expect(JSON.stringify(test)).not.toContain(KEY)
  })

  it('refuses a save without a default once one was delivered, but allows a first-time draft', async () => {
    await call('PATCH', '', config1())  // never routed: a draft is fine
    expect((await call('PATCH', '', config1({}, { margin_bps: 1000 }))).status).toBe(200)
    await call('POST', '/test', { provider: 'oai', model: 'gpt-4o' }, { fetch: withUsage().fetcher })
    expect((await call('PATCH', '', config1({ default: 'mid' }, { providers: { oai: { preset: 'openai' } } }))).status).toBe(200)
    const dropped = await call('PATCH', '', config1({}, { providers: { oai: { preset: 'openai' } } }))
    expect(dropped).toEqual({ status: 422, body: { code: 'default_required' } })
    expect((await call('GET', '')).body.setting).toMatchObject({ delivery: 'delivered', routes: { default: 'mid' } })
  })

  it('does not call a file in the old shape delivered, even with the same revision', async () => {
    await routedSave()
    expect((await call('GET', '')).body.setting.delivery).toBe('delivered')
    await writeFile(providerFile(), JSON.stringify({ provider: 'openai', model: 'gpt-4o', api_key: KEY, revision: 2 }))
    expect((await call('GET', '')).body.setting.delivery).toBe('pending')
  })

  it('writes the file at start from a complete stored configuration when it is missing or in the old shape, leaves an identical one, and does nothing for an incomplete one', async () => {
    expect(await syncProviderFile(pool, config)).toBe('incomplete')  // nothing stored
    await call('PATCH', '', config1())
    expect(await syncProviderFile(pool, config)).toBe('incomplete')  // a draft
    await expect(readFile(providerFile(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await syncProviderFile(pool, { ...config, aiPlatformProviderPath: undefined } as Config)).toBe('unconfigured')
    // The carried-forward shape: a default route to an unpriced, untested model, and an old-format file on disk.
    await pool.query("INSERT INTO ai_route(quality, capability, model_id) VALUES('default','default','mid')")
    await writeFile(providerFile(), JSON.stringify({ provider: 'openai', model: 'gpt-4o', api_key: KEY, revision: 1 }))
    expect(await syncProviderFile(pool, config)).toBe('written')
    const written = await fileJson()
    expect(written).toMatchObject({ revision: 1, margin_bps: 2000, providers: { oai: { provider: 'openai', api_key: KEY } }, models: { mid: { provider: 'oai', model: 'gpt-4o' } }, routes: { default: 'mid' } })
    expect((await stat(providerFile())).mode & 0o777).toBe(0o640)
    const before = await stat(providerFile())
    expect(await syncProviderFile(pool, config)).toBe('unchanged')
    expect((await stat(providerFile())).ino).toBe(before.ino)
    expect((await call('GET', '')).body.setting.delivery).toBe('delivered')
    await rm(providerFile())
    expect(await syncProviderFile(pool, config)).toBe('written')
  })

  it('does not crash the start when the file cannot be written or the key cannot be opened', async () => {
    await call('PATCH', '', config1())
    await pool.query("INSERT INTO ai_route(quality, capability, model_id) VALUES('default','default','mid')")
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(await syncProviderFile(pool, { ...config, aiPlatformProviderPath: join(dir, 'missing', 'platform-provider.json') } as Config)).toBe('failed')
      expect(await syncProviderFile(pool, { ...config, admin: undefined } as Config)).toBe('failed')
      expect(quiet.mock.calls.flat().join(' ')).not.toContain(KEY)
    } finally { quiet.mockRestore() }
  })

  it('records a test result only if the provider and model are still what was tested', async () => {
    const custom = { margin_bps: 0, providers: { c: { preset: 'custom', api_key: KEY, base_url: 'https://llm.example.com/v1', stream_usage: true } }, models: { m: { provider: 'c', model: 'm' } }, routes: {}, reason: 'Custom endpoint' }
    await call('PATCH', '', custom)
    expect((await call('POST', '/test', { provider: 'c', model: 'm' }, { fetch: withUsage().fetcher })).body).toMatchObject({ usage_reported: true })
    expect((await call('GET', '')).body.setting.models.m.usage_reported).toBe(true)
    // While the provider answers, the vendor stops asking the stream for token counts: the answer must not be recorded.
    const changing: Fetcher = async () => {
      await call('PATCH', '', { ...custom, providers: { c: { preset: 'custom', base_url: 'https://llm.example.com/v1', stream_usage: false } } })
      return sse(CHUNK, USAGE, '[DONE]')
    }
    expect((await call('POST', '/test', { provider: 'c', model: 'm' }, { fetch: changing })).body).toMatchObject({ ok: true, usage_reported: true })
    expect((await call('GET', '')).body.setting.models.m.usage_reported).toBe(false)
    // Likewise when the model is renamed meanwhile.
    await call('POST', '/test', { provider: 'c', model: 'm' }, { fetch: recorder(() => sse(CHUNK, '[DONE]')).fetcher })
    const renaming: Fetcher = async () => {
      await call('PATCH', '', { ...custom, providers: { c: { preset: 'custom', base_url: 'https://llm.example.com/v1', stream_usage: false } }, models: { m: { provider: 'c', model: 'm2' } } })
      return sse(CHUNK, USAGE, '[DONE]')
    }
    await call('POST', '/test', { provider: 'c', model: 'm' }, { fetch: renaming })
    expect((await call('GET', '')).body.setting.models.m).toMatchObject({ model: 'm2', usage_reported: false })
  })

  it('moves a model to another provider and removes the old one in one save, leaving no orphan', async () => {
    const two = { oai: { preset: 'openai', api_key: KEY }, ds: { preset: 'deepseek', api_key: `${KEY}-2` } }
    const priced = { input_price: '1', output_price: '2' }
    const first = { margin_bps: 0, providers: two, models: { m: { provider: 'oai', model: 'gpt-4o', ...priced } }, routes: {}, reason: 'Two providers' }
    expect((await call('PATCH', '', first)).status).toBe(200)
    const moved = await call('PATCH', '', { margin_bps: 0, providers: { ds: { preset: 'deepseek' } }, models: { m: { provider: 'ds', model: 'deepseek-chat', ...priced } }, routes: {}, reason: 'Move the model' })
    expect(moved.status).toBe(200)
    expect(moved.body.setting.models).toEqual({ m: expect.objectContaining({ provider: 'ds', model: 'deepseek-chat', usage_reported: false }) })
    expect(Object.keys(moved.body.setting.providers)).toEqual(['ds'])
    expect((await pool.query('SELECT 1 FROM ai_model m LEFT JOIN ai_provider p ON p.id = m.provider_id WHERE p.id IS NULL')).rowCount).toBe(0)
    expect((await pool.query('SELECT id FROM ai_provider')).rows).toEqual([{ id: 'ds' }])
  })

  it('removes a model together with the route cell that used it', async () => {
    await routedSave()
    await call('PATCH', '', { ...config1({ default: 'mid' }, { providers: { oai: { preset: 'openai' } } }), models: { mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.5', output_price: '10' }, extra: { provider: 'oai', model: 'gpt-4o-mini' } } })
    const withCell = { ...config1({ default: 'mid', best: { writing: 'extra' } }, { providers: { oai: { preset: 'openai' } } }), models: { mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.5', output_price: '10' }, extra: { provider: 'oai', model: 'gpt-4o-mini', input_price: '1', output_price: '1' } } }
    expect((await call('PATCH', '', withCell)).body.code).toBe('model_not_tested')  // the cell cannot route an untested model: the removal below is what matters
    await pool.query("INSERT INTO ai_model(id, provider_id, model, input_price, output_price, usage_reported) VALUES('extra2','oai','x',1,1,true)")
    await pool.query("INSERT INTO ai_route(quality, capability, model_id) VALUES('best','writing','extra2')")
    const removed = await call('PATCH', '', config1({ default: 'mid' }, { providers: { oai: { preset: 'openai' } } }))
    expect(removed.status).toBe(200)
    expect(removed.body.setting.routes).toEqual({ default: 'mid' })
    expect(Object.keys(removed.body.setting.models)).toEqual(['mid'])
    expect((await pool.query('SELECT 1 FROM ai_route WHERE model_id NOT IN (SELECT id FROM ai_model)')).rowCount).toBe(0)
  })

  it('refuses removing a provider a kept model still uses with the validation error, not a database error', async () => {
    await call('PATCH', '', config1())
    const refused = await call('PATCH', '', { margin_bps: 2000, providers: {}, models: config1().models, routes: {}, reason: 'Remove the provider' })
    expect(refused).toEqual({ status: 422, body: { code: 'unknown_provider' } })
    expect((await call('GET', '')).body.setting.providers).toHaveProperty('oai')
  })

  /** The state the migration leaves: provider oai, an unpriced untested model `main`, routed as the default, and a file in the current shape. */
  async function migratedState() {
    await call('PATCH', '', { margin_bps: 2000, providers: { oai: { preset: 'openai', api_key: KEY } }, models: { main: { provider: 'oai', model: 'gpt-4o' } }, routes: {}, reason: 'As migrated' })
    await pool.query("INSERT INTO ai_route(quality, capability, model_id) VALUES('default','default','main')")
  }
  const second = (over: object = {}, models: object = {}) => ({
    margin_bps: 2000, reason: 'Switch the default',
    providers: { oai: { preset: 'openai' }, ds: { preset: 'deepseek', api_key: `${KEY}-2` } },
    models: { main: { provider: 'oai', model: 'gpt-4o' }, m2: { provider: 'ds', model: 'deepseek-chat', input_price: '0.14', output_price: '0.28' }, ...models },
    routes: { default: 'main' }, ...over,
  })

  it('lets the vendor leave an unavailable migrated default behind in two saves: add and test a replacement, then switch', async () => {
    await migratedState()
    const added = await call('PATCH', '', second())  // the migrated default is untouched: accepted although unpriced and untested
    expect(added.status).toBe(200)
    expect(added.body.setting.routes).toEqual({ default: 'main' })
    expect((await call('POST', '/test', { provider: 'ds', model: 'deepseek-chat' }, { fetch: withUsage().fetcher })).body).toMatchObject({ usage_reported: true })
    const switched = await call('PATCH', '', second({ routes: { default: 'm2' }, providers: { oai: { preset: 'openai' }, ds: { preset: 'deepseek' } } }))
    expect(switched.status).toBe(200)
    expect(switched.body.setting).toMatchObject({ delivery: 'delivered', routes: { default: 'm2' } })
    expect((await fileJson()).routes).toEqual({ default: 'm2' })
    const cleaned = await call('PATCH', '', { margin_bps: 2000, reason: 'Drop the old one', providers: { ds: { preset: 'deepseek' } }, models: { m2: second().models.m2 }, routes: { default: 'm2' } })
    expect(cleaned.status).toBe(200)
    expect(Object.keys(cleaned.body.setting.models)).toEqual(['m2'])
  })

  it('still refuses a route changed to a model that is untested or unpriced', async () => {
    await migratedState()
    await call('PATCH', '', second())
    expect((await call('PATCH', '', second({ routes: { default: 'm2' } }))).body.code).toBe('model_not_tested')
    expect((await call('PATCH', '', second({ routes: { default: 'main', best: { writing: 'm2' } } }))).body.code).toBe('model_not_tested')  // a new cell too
    expect((await call('PATCH', '', second({ routes: { default: 'main', best: { writing: 'main' } } }))).body.code).toBe('model_not_priced')
    expect((await call('GET', '')).body.setting.routes).toEqual({ default: 'main' })
  })

  it('treats the route of the migrated model as changed when its name or its provider endpoint is edited', async () => {
    await migratedState()
    const renamed = second({}, { main: { provider: 'oai', model: 'gpt-4o-mini', input_price: '1', output_price: '2' } })
    expect((await call('PATCH', '', renamed)).body.code).toBe('model_not_tested')
    const moved = second({}, { main: { provider: 'ds', model: 'gpt-4o', input_price: '1', output_price: '2' } })
    expect((await call('PATCH', '', moved)).body.code).toBe('model_not_tested')
    // An unchanged name with a changed provider endpoint (a custom provider) resets the result as well.
    await pool.query('TRUNCATE ai_route, ai_model, ai_provider, ai_provider_config')
    await call('PATCH', '', { margin_bps: 0, providers: { c: { preset: 'custom', api_key: KEY, base_url: 'https://llm.example.com/v1' } }, models: { main: { provider: 'c', model: 'm' } }, routes: {}, reason: 'Custom provider' })
    await pool.query("INSERT INTO ai_route(quality, capability, model_id) VALUES('default','default','main')")
    const sameEndpoint = { margin_bps: 0, providers: { c: { preset: 'custom', base_url: 'https://llm.example.com/v1' } }, models: { main: { provider: 'c', model: 'm' } }, routes: { default: 'main' }, reason: 'Unchanged' }
    expect((await call('PATCH', '', sameEndpoint)).status).toBe(200)
    const otherEndpoint = { ...sameEndpoint, providers: { c: { preset: 'custom', base_url: 'https://other.example.com/v1', api_key: KEY } } }
    expect((await call('PATCH', '', otherEndpoint)).body.code).toBe('model_not_priced')
  })

  it('carries the single provider of the old table forward as provider and model "main" on the default route, and leaves no old table', async () => {
    const sealed = Buffer.from('sealed-key-box')
    await pool.query('DROP TABLE ai_route, ai_model, ai_provider, ai_provider_config')
    await pool.query(await readFile(new URL('../schema_032.sql', import.meta.url), 'utf8'))
    await pool.query(
      `INSERT INTO ai_platform_provider(preset, provider, model, base_url, stream_usage, api_key_sealed, api_key_last4, revision, updated_by) VALUES('deepseek','openai_compatible','deepseek-chat','https://api.deepseek.com/v1',true,$1,'6789',7,'account:3')`,
      [sealed],
    )
    await pool.query(await readFile(new URL('../schema_042.sql', import.meta.url), 'utf8'))
    expect((await pool.query("SELECT to_regclass('ai_platform_provider') AS gone")).rows[0].gone).toBeNull()
    const migrated = (await call('GET', '')).body.setting
    expect(migrated).toMatchObject({
      revision: 7, margin_bps: 0, updated_by: 'account:3', delivery: 'pending', routes: { default: 'main' },
      providers: { main: { preset: 'deepseek', provider: 'openai_compatible', base_url: 'https://api.deepseek.com/v1', stream_usage: true, key: { configured: true, last4: '6789' } } },
      models: { main: { provider: 'main', model: 'deepseek-chat', input_price: null, cached_input_price: null, output_price: null, usage_reported: false } },
    })
    expect((await pool.query('SELECT api_key_sealed FROM ai_provider')).rows[0].api_key_sealed.equals(sealed)).toBe(true)
    // An empty old table carries nothing forward.
    await pool.query('DROP TABLE ai_route, ai_model, ai_provider, ai_provider_config')
    await pool.query(await readFile(new URL('../schema_032.sql', import.meta.url), 'utf8'))
    await pool.query(await readFile(new URL('../schema_042.sql', import.meta.url), 'utf8'))
    expect((await call('GET', '')).body).toEqual({ setting: null })
  })
})
