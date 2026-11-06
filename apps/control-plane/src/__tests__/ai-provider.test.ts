import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool, type PoolClient } from 'pg'
import type { VendorCapability } from '@liwan/commercial-contracts'
import { migrate } from '../db.js'
import type { Config } from '../config.js'
import { aiProviderHttp } from '../ai-provider/http.js'
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

  beforeAll(async () => { await migrate(pool) })
  afterAll(async () => { await pool.end() })
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ai-provider-'))
    config = { admin: { secretKey: SECRET, rpId: 'localhost', origin: 'http://localhost', rpName: 'LiwanOS' }, aiPlatformProviderPath: providerFile() } as unknown as Config
    await pool.query('TRUNCATE ai_platform_provider')
    await pool.query("DELETE FROM audit_events WHERE action LIKE 'ai.platform_provider.%'")
  })

  it('answers nothing outside its resource, needs the operations capability for every route and refuses unknown methods', async () => {
    expect(await aiProviderHttp(pool, config, { method: 'GET', pathname: '/v1/tenants', raw: '', auth: auth(), requireCapability, fail })).toBeNull()
    await expect(call('GET', '/presets', undefined, { auth: auth(['vendor.read'], { method: 'GET' }) })).rejects.toThrow('forbidden')
    // The operations capability is not enough: the AI provider has its own, which only the owner role holds.
    for (const [method, path] of [['GET', ''], ['PATCH', ''], ['GET', '/presets'], ['POST', '/models'], ['POST', '/test']] as const) {
      await expect(call(method, path, method === 'GET' ? undefined : {}, { auth: auth(['vendor.read', 'vendor.operations.run', 'vendor.accounts.manage'], { method }) }), `${method} ${path}`).rejects.toThrow('forbidden')
    }
    await expect(call('PATCH', '', { preset: 'openai' }, { auth: auth(undefined, { method: 'PATCH', stepUpFresh: false }) })).rejects.toThrow('step_up_required')
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

  it('saves with a write-only key: sealed at rest, last four in the answer, the file for the AI service written, the save audited without the key', async () => {
    const saved = await call('PATCH', '', { preset: 'deepseek', model: 'deepseek-chat', api_key: KEY, reason: 'Switch the platform provider' })
    expect(saved.status).toBe(200)
    expect(saved.body.setting).toMatchObject({ preset: 'deepseek', provider: 'openai_compatible', model: 'deepseek-chat', base_url: 'https://api.deepseek.com/v1', stream_usage: true, key: { configured: true, last4: '6789' }, revision: 1, updated_by: 'account:7', delivery: 'delivered' })
    expect(JSON.stringify(saved.body)).not.toContain(KEY)
    expect(JSON.parse(await readFile(providerFile(), 'utf8'))).toEqual({ provider: 'openai_compatible', model: 'deepseek-chat', base_url: 'https://api.deepseek.com/v1', api_key: KEY, stream_usage: true, revision: 1 })
    expect((await stat(providerFile())).mode & 0o777).toBe(0o640)
    const row = (await pool.query('SELECT api_key_sealed FROM ai_platform_provider')).rows[0]
    expect(row.api_key_sealed.toString('utf8')).not.toContain(KEY)
    expect(JSON.stringify((await call('GET', '')).body)).not.toContain(KEY)
    const audit = (await pool.query("SELECT actor, subject, reason, metadata FROM audit_events WHERE action='ai.platform_provider.saved'")).rows
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor: 'account:7', subject: 'platform-ai-provider', reason: 'Switch the platform provider' })
    expect(audit[0].metadata).toMatchObject({ preset: 'deepseek', model: 'deepseek-chat', revision: 1, key_changed: true, stream_usage: true })
    expect(JSON.stringify(audit)).not.toContain(KEY)
  })

  it('keeps the stored key while the preset and endpoint stay, raises the revision, and asks for a key when they change', async () => {
    await call('PATCH', '', { preset: 'groq', model: 'llama-3.3-70b', api_key: KEY, reason: 'First choice' })
    const again = await call('PATCH', '', { preset: 'groq', model: 'llama-3.1-8b', reason: 'Cheaper model' })
    expect(again.body.setting).toMatchObject({ model: 'llama-3.1-8b', revision: 2, key: { configured: true, last4: '6789' } })
    expect(JSON.parse(await readFile(providerFile(), 'utf8'))).toMatchObject({ api_key: KEY, revision: 2 })
    const other = await call('PATCH', '', { preset: 'xai', model: 'grok', reason: 'Another provider' })
    expect(other).toEqual({ status: 422, body: { code: 'api_key_required' } })
    expect((await call('GET', '')).body.setting.revision).toBe(2)
  })

  it('stores a self-hosted endpoint without a key, and refuses what a preset cannot take', async () => {
    const ollama = await call('PATCH', '', { preset: 'ollama', model: 'qwen2.5:7b', base_url: 'http://ollama:11434/', reason: 'Self-hosted model' })
    expect(ollama.body.setting).toMatchObject({ provider: 'ollama', base_url: 'http://ollama:11434', stream_usage: false, key: { configured: false, last4: null } })
    expect(JSON.parse(await readFile(providerFile(), 'utf8'))).toEqual({ provider: 'ollama', model: 'qwen2.5:7b', base_url: 'http://ollama:11434', revision: 1 })
    const reasons = (preset: string, extra: object) => call('PATCH', '', { preset, model: 'm', reason: 'Checking', ...extra })
    expect((await reasons('ollama', {})).body.code).toBe('invalid_base_url')
    expect((await reasons('ollama', { base_url: 'https://u:p@h.example' })).body.code).toBe('invalid_base_url')
    expect((await reasons('ollama', { base_url: 'http://ollama:11434', api_key: KEY })).body.code).toBe('api_key_not_allowed')
    expect((await reasons('openai', { api_key: KEY, base_url: 'https://elsewhere.example/v1' })).body.code).toBe('invalid_base_url')
    expect((await reasons('nope', { api_key: KEY })).body.code).toBe('invalid_preset')
    expect((await reasons('custom', { api_key: KEY, base_url: 'https://llm.example.com/v1' })).status).toBe(200)
  })

  it('writes the named providers without an endpoint and with their own token-count rule', async () => {
    const saved = await call('PATCH', '', { preset: 'openai', model: 'gpt-4o', api_key: KEY, reason: 'Native OpenAI' })
    expect(saved.body.setting).toMatchObject({ preset: 'openai', provider: 'openai', base_url: null, stream_usage: true })
    expect(JSON.parse(await readFile(providerFile(), 'utf8'))).toEqual({ provider: 'openai', model: 'gpt-4o', api_key: KEY, stream_usage: true, revision: 1 })
    await call('PATCH', '', { preset: 'anthropic', model: 'claude-sonnet-4-5', api_key: KEY, reason: 'Anthropic' })
    expect(JSON.parse(await readFile(providerFile(), 'utf8'))).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5', api_key: KEY, revision: 2 })  // reports counts on its own
    await call('PATCH', '', { preset: 'openrouter', model: 'anthropic/claude-sonnet-4.5', api_key: KEY, reason: 'OpenRouter' })
    expect(JSON.parse(await readFile(providerFile(), 'utf8'))).toMatchObject({ provider: 'openrouter', stream_usage: true })
    expect(JSON.parse(await readFile(providerFile(), 'utf8'))).not.toHaveProperty('base_url')
  })

  it('lets the vendor tick the token-count option of a custom endpoint only, keeps it across saves, and refuses a contradiction of a fixed preset', async () => {
    const custom = { preset: 'custom', model: 'm', api_key: KEY, base_url: 'https://llm.example.com/v1' }
    expect((await call('PATCH', '', { ...custom, reason: 'Custom endpoint' })).body.setting.stream_usage).toBe(false)
    expect(JSON.parse(await readFile(providerFile(), 'utf8'))).toMatchObject({ stream_usage: false })
    expect((await call('PATCH', '', { ...custom, stream_usage: true, reason: 'It reports usage' })).body.setting.stream_usage).toBe(true)
    expect(JSON.parse(await readFile(providerFile(), 'utf8'))).toMatchObject({ provider: 'openai_compatible', stream_usage: true })
    const kept = await call('PATCH', '', { preset: 'custom', model: 'm2', base_url: 'https://llm.example.com/v1', reason: 'New model' })
    expect(kept.body.setting).toMatchObject({ stream_usage: true, model: 'm2' })
    expect((await call('PATCH', '', { preset: 'groq', model: 'm', api_key: KEY, stream_usage: false, reason: 'Turn it off' })).body.code).toBe('invalid_stream_usage')
    expect((await call('PATCH', '', { preset: 'groq', model: 'm', api_key: KEY, stream_usage: true, reason: 'Same as default' })).status).toBe(200)
    expect((await call('POST', '/test', { preset: 'groq', model: 'm', api_key: KEY, stream_usage: false }, { fetch: recorder(() => sse(CHUNK, USAGE)).fetcher })).body.code).toBe('invalid_stream_usage')
  })

  it('rolls the whole save back when the file cannot be written, and reports a stale file as pending', async () => {
    const broken = { ...config, aiPlatformProviderPath: join(dir, 'missing-dir', 'platform-provider.json') } as Config
    const failed = await call('PATCH', '', { preset: 'openai', model: 'gpt-4o', api_key: KEY, reason: 'Switch provider' }, { config: broken })
    expect(failed).toEqual({ status: 503, body: { code: 'provider_file_unavailable' } })
    expect((await call('GET', '')).body).toEqual({ setting: null })
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='ai.platform_provider.saved'")).rowCount).toBe(0)
    await call('PATCH', '', { preset: 'openai', model: 'gpt-4o', api_key: KEY, reason: 'Switch provider' })
    await writeFile(providerFile(), JSON.stringify({ provider: 'openai_compatible', model: 'gpt-4o', revision: 0 }))
    expect((await call('GET', '')).body.setting.delivery).toBe('pending')
    expect((await call('GET', '', undefined, { config: { ...config, aiPlatformProviderPath: undefined } as Config })).body.setting.delivery).toBe('unconfigured')
  })

  it('writes the audit entry before the file and the file last, right before COMMIT, and restores the previous file when COMMIT fails', async () => {
    await call('PATCH', '', { preset: 'groq', model: 'first', api_key: KEY, reason: 'First choice' })
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
    await expect(call('PATCH', '', { preset: 'groq', model: 'second', reason: 'Second choice' }, { pool: failing })).rejects.toThrow('commit failed')
    expect(order).toEqual(['audit (file already new: false)', 'commit (file already new: true)'])
    expect(await readFile(providerFile(), 'utf8')).toBe(before)  // the previous content is back
    expect((await call('GET', '')).body.setting).toMatchObject({ model: 'first', revision: 1 })
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='ai.platform_provider.saved'")).rowCount).toBe(1)
  })

  it('removes the file again when the very first save fails at COMMIT, and sweeps temporary files a crashed write left behind', async () => {
    const failing: Pool = { query: pool.query.bind(pool), connect: async () => withQueryHook(await pool.connect(), async (sql, run) => { if (sql === 'COMMIT') throw new Error('commit failed'); return run() }) } as unknown as Pool
    await writeFile(join(dir, '.platform-provider.crashed.tmp'), '{"api_key":"left over"}')
    await expect(call('PATCH', '', { preset: 'groq', model: 'm', api_key: KEY, reason: 'First choice' }, { pool: failing })).rejects.toThrow('commit failed')
    await expect(readFile(providerFile(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(dir)).toEqual([])  // the stale temporary file is gone too
    await writeFile(join(dir, '.platform-provider.crashed2.tmp'), 'x')
    await writeFile(join(dir, 'unrelated.txt'), 'keep')
    await call('PATCH', '', { preset: 'groq', model: 'm', api_key: KEY, reason: 'First choice' })
    expect((await readdir(dir)).sort()).toEqual(['platform-provider.json', 'unrelated.txt'])
  })

  it('audits every models and test call with the preset, the host and the outcome, and never the key', async () => {
    const reply = recorder(({ url: u }) => (u.endsWith('/models') ? json({ data: [{ id: 'm1' }] }) : sse(CHUNK, USAGE)))
    await call('POST', '/models', { preset: 'groq', api_key: KEY }, { fetch: reply.fetcher })
    await call('POST', '/test', { preset: 'groq', model: 'm1', api_key: KEY }, { fetch: reply.fetcher })
    await call('POST', '/test', { preset: 'deepseek', model: 'm1', api_key: KEY }, { fetch: async () => new Response('no', { status: 401 }) })
    await call('POST', '/test', { preset: 'xai', model: 'm1' }, { fetch: reply.fetcher })
    await call('POST', '/models', { preset: 'custom', base_url: 'https://169.254.169.254.nip.io/v1', api_key: KEY }, { resolve: async () => ['169.254.169.254'] })
    const rows = (await pool.query("SELECT action, subject, reason, actor, metadata FROM audit_events WHERE action IN ('ai.platform_provider.models_listed','ai.platform_provider.tested') ORDER BY created_at, id")).rows
    expect(rows.map(r => [r.action.split('.').pop(), r.metadata])).toEqual([
      ['models_listed', { preset: 'groq', host: 'api.groq.com', outcome: 'ok' }],
      ['tested', { preset: 'groq', host: 'api.groq.com', outcome: 'ok' }],
      ['tested', { preset: 'deepseek', host: 'api.deepseek.com', outcome: 'unauthorized' }],
      ['tested', { preset: 'xai', host: 'api.x.ai', outcome: 'key_missing' }],
      ['models_listed', { preset: 'custom', host: '169.254.169.254.nip.io', outcome: 'invalid_base_url' }],
    ])
    expect(rows.every(r => r.subject === 'platform-ai-provider' && r.actor === 'account:7')).toBe(true)
    expect(JSON.stringify(rows)).not.toContain(KEY)
  })

  it('refuses a custom endpoint that is, or resolves to, an internal address, in models, test and save, but lets Ollama reach a private host', async () => {
    const internal = { 'internal.example.com': ['10.0.0.9'], '169.254.169.254.nip.io': ['169.254.169.254'] }
    const resolve: Resolver = async host => { if (host in internal) return internal[host as keyof typeof internal]; return ['93.184.216.34'] }
    for (const base_url of ['https://169.254.169.254.nip.io/v1', 'https://internal.example.com/v1', 'https://[::ffff:169.254.169.254]/v1', 'https://localhost/v1', 'https://0.0.0.0/v1', 'https://[fd00:ec2::254]/v1', 'http://llm.example.com/v1']) {
      const custom = { preset: 'custom', base_url, api_key: KEY }
      expect((await call('POST', '/models', custom, { resolve })).body.code, base_url).toBe('invalid_base_url')
      expect((await call('POST', '/test', { ...custom, model: 'm' }, { resolve })).body.code, base_url).toBe('invalid_base_url')
      expect((await call('PATCH', '', { ...custom, model: 'm', reason: 'Custom endpoint' }, { resolve })).body.code, base_url).toBe('invalid_base_url')
    }
    expect((await call('GET', '')).body).toEqual({ setting: null })
    const ok = recorder(() => json({ models: [{ name: 'qwen' }] }))
    expect((await call('POST', '/models', { preset: 'ollama', base_url: 'http://10.0.0.5:11434' }, { fetch: ok.fetcher, resolve })).body.items).toEqual([{ id: 'qwen' }])
    expect((await call('POST', '/models', { preset: 'ollama', base_url: 'http://169.254.169.254' }, { fetch: ok.fetcher, resolve })).body.code).toBe('invalid_base_url')
    expect((await call('PATCH', '', { preset: 'ollama', model: 'qwen', base_url: 'http://10.0.0.5:11434', reason: 'Internal Ollama' }, { resolve })).status).toBe(200)
  })

  it('refuses a custom endpoint on a non-443 port in models, test and save with the stable code invalid_base_url_port, but not Ollama on its port', async () => {
    const resolve: Resolver = async () => ['93.184.216.34']
    const custom = { preset: 'custom', base_url: 'https://provider.example:8443/v1', api_key: KEY }
    expect((await call('POST', '/models', custom, { resolve })).body.code).toBe('invalid_base_url_port')
    expect((await call('POST', '/test', { ...custom, model: 'm' }, { resolve })).body.code).toBe('invalid_base_url_port')
    expect((await call('PATCH', '', { ...custom, model: 'm', reason: 'Odd port' }, { resolve })).body.code).toBe('invalid_base_url_port')
    expect((await call('GET', '')).body).toEqual({ setting: null })
    expect((await call('PATCH', '', { ...custom, base_url: 'https://provider.example:443/v1', model: 'm', reason: 'Default port' }, { resolve })).body.setting.base_url).toBe('https://provider.example/v1')
    expect((await call('PATCH', '', { preset: 'ollama', model: 'qwen', base_url: 'http://10.0.0.5:11434', reason: 'Internal Ollama' }, { resolve })).status).toBe(200)
  })

  it('holds the save lock until a failed save has restored the file, so a waiting save is not overwritten by the late restore', async () => {
    await call('PATCH', '', { preset: 'groq', model: 'first', api_key: KEY, reason: 'First choice' })
    const first = await readFile(providerFile(), 'utf8')
    let reachedCommit!: () => void
    const atCommit = new Promise<void>((resolve) => { reachedCommit = resolve })
    let failCommit!: () => void
    const gate = new Promise<void>((resolve) => { failCommit = resolve })
    const failing: Pool = { query: pool.query.bind(pool), connect: async () => withQueryHook(await pool.connect(), async (sql, run) => {
      if (sql === 'COMMIT') { reachedCommit(); await gate; throw new Error('commit failed') }
      if (sql === 'ROLLBACK') { const done = await run(); await new Promise(resolve => setTimeout(resolve, 400)); return done }  // widen the window between the rollback and the restore
      return run()
    }) } as unknown as Pool
    const loser = call('PATCH', '', { preset: 'groq', model: 'loser', reason: 'Fails at COMMIT' }, { pool: failing })
    const loserOutcome = loser.then(() => 'saved', (error: Error) => error.message)
    await atCommit
    expect(await readFile(providerFile(), 'utf8')).not.toBe(first)  // the losing save's file is in place, its COMMIT pending
    let winnerDone = false
    const winner = call('PATCH', '', { preset: 'groq', model: 'winner', reason: 'Waits for the lock' }).then((result) => { winnerDone = true; return result })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(winnerDone).toBe(false)  // the winner waits: the lock is not the transaction's, it outlives the rollback
    failCommit()
    expect(await loserOutcome).toBe('commit failed')
    const won = await winner
    expect(won.body.setting).toMatchObject({ model: 'winner', revision: 2 })
    expect(JSON.parse(await readFile(providerFile(), 'utf8'))).toMatchObject({ model: 'winner', revision: 2 })  // not the loser's restored content
    expect((await call('GET', '')).body.setting).toMatchObject({ model: 'winner', revision: 2, delivery: 'delivered' })
  })

  it('needs the control plane secret to take a key', async () => {
    const noSecret = { ...config, admin: undefined } as Config
    expect((await call('PATCH', '', { preset: 'openai', model: 'm', api_key: KEY, reason: 'No secret here' }, { config: noSecret })).body.code).toBe('secret_key_unavailable')
  })

  it('lists models and tests a connection with the key it was given, or the stored one only for the stored preset and endpoint', async () => {
    const { fetcher, seen } = recorder(({ url: u }) => u.endsWith('/models') ? json({ data: [{ id: 'm1' }] }) : sse(CHUNK))
    expect((await call('POST', '/models', { preset: 'openai' }, { fetch: fetcher })).body.code).toBe('api_key_required')
    const listed = await call('POST', '/models', { preset: 'openai', api_key: KEY }, { fetch: fetcher })
    expect(listed.body).toEqual({ items: [{ id: 'm1' }], total: 1 })
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    await call('PATCH', '', { preset: 'openai', model: 'gpt-4o', api_key: KEY, reason: 'Switch provider' })
    seen.length = 0
    expect((await call('POST', '/test', { preset: 'openai', model: 'gpt-4o' }, { fetch: fetcher })).body).toEqual({ ok: true, latency_ms: expect.any(Number), usage_reported: false })
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)  // the stored key, same preset
    expect((await call('POST', '/test', { preset: 'groq', model: 'm' }, { fetch: fetcher })).body).toEqual({ ok: false, code: 'key_missing' })  // never sent to another host
    expect((await call('POST', '/test', { preset: 'ollama', model: 'qwen', base_url: 'http://ollama:11434' }, { fetch: fetcher })).body).toMatchObject({ ok: true })
  })

  it('tells the vendor whether the reply carried token counts, asking for them as the saved or ticked option says', async () => {
    const withUsage = recorder(() => sse(CHUNK, USAGE, '[DONE]'))
    expect((await call('POST', '/test', { preset: 'deepseek', model: 'm', api_key: KEY }, { fetch: withUsage.fetcher })).body).toMatchObject({ ok: true, usage_reported: true })
    expect(JSON.parse(withUsage.seen[0]!.init.body as string)).toMatchObject({ stream: true, stream_options: { include_usage: true } })
    const without = recorder(() => sse(CHUNK, '[DONE]'))
    const custom = { preset: 'custom', model: 'm', api_key: KEY, base_url: 'https://llm.example.com/v1' }
    expect((await call('POST', '/test', custom, { fetch: without.fetcher })).body).toMatchObject({ ok: true, usage_reported: false })
    expect(JSON.parse(without.seen[0]!.init.body as string)).not.toHaveProperty('stream_options')
    expect((await call('POST', '/test', { ...custom, stream_usage: true }, { fetch: withUsage.fetcher })).body).toMatchObject({ ok: true, usage_reported: true })
    expect(JSON.parse(withUsage.seen[1]!.init.body as string)).toHaveProperty('stream_options')
    const refuses: Fetcher = async () => new Response('stream_options is not supported', { status: 400 })
    expect((await call('POST', '/test', { ...custom, stream_usage: true }, { fetch: refuses })).body).toEqual({ ok: false, code: 'stream_usage_refused' })
  })

  it('answers a failing test with a stable code only, and a failing model list with a coded error', async () => {
    const unauthorized: Fetcher = async () => new Response(`bad key ${KEY}`, { status: 401 })
    const test = await call('POST', '/test', { preset: 'openai', model: 'gpt-4o', api_key: KEY }, { fetch: unauthorized })
    expect(test).toEqual({ status: 200, body: { ok: false, code: 'unauthorized' } })
    expect((await call('POST', '/models', { preset: 'openai', api_key: KEY }, { fetch: unauthorized })).body.code).toBe('provider_unauthorized')
    const down: Fetcher = async () => { throw new TypeError(`fetch failed for ${KEY}`) }
    expect((await call('POST', '/models', { preset: 'openai', api_key: KEY }, { fetch: down })).body.code).toBe('provider_unreachable')
    expect(JSON.stringify(test)).not.toContain(KEY)
  })
})
