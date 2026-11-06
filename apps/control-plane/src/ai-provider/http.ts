import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import {
  aiProviderCurrentSchema, aiProviderModelsRequestSchema, aiProviderModelsSchema, aiProviderPresetListSchema, aiProviderSaveSchema,
  aiProviderSettingSchema, aiProviderTestRequestSchema, aiProviderTestResultSchema, type VendorCapability,
} from '@liwan/commercial-contracts'
import { actorName } from '../admin-auth/accounts.js'
import type { Config } from '../config.js'
import { listModels, ProviderCallError, testCompletion, type Fetcher, type ProbeTarget } from './client.js'
import { checkEndpoint, EndpointError, type Resolver } from './endpoint.js'
import { guardedFetcher } from './guarded-fetch.js'
import { findPreset, PRESETS, publicPreset, type Preset } from './presets.js'
import { AI_PROVIDER_SAVE_LOCK, openKey, providerFileContent, readProvider, replaceProviderFile, sealKey, settingOf, writeProvider, type StoredProvider } from './store.js'

type Auth = { actor: number; capabilities: VendorCapability[]; stepUpFresh: boolean; method: string }
type Input = { method: string; pathname: string; raw: string; auth: Auth; requireCapability: (auth: Auth, capability: VendorCapability) => void; fail: (status: number, code: string) => Error }
type Result = { status: number; data: unknown }
/** Tests inject a fetcher (no network) or a resolver (the real guarded fetcher, names resolved by the test). */
export type AiProviderDeps = { fetch?: Fetcher; resolve?: Resolver }

const ROOT = '/v1/platform/ai-provider'
const SUBJECT = 'platform-ai-provider'
const LAST_CHARS = 4

function body<T extends z.ZodType>(schema: T, raw: string, fail: Input['fail']): z.infer<T> {
  let json: unknown
  try { json = JSON.parse(raw) } catch { throw fail(422, 'invalid') }
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw fail(422, 'invalid')
  return parsed.data
}

/**
 * The preset and its endpoint for a request. A fixed preset refuses a different endpoint; a free one (Ollama, custom) requires
 * its own, which must be a public https endpoint (a private or plain-http one only for Ollama) and, if it names a host, must
 * not resolve to a forbidden address now (the connection checks again, so a later change of answer cannot pass).
 */
async function endpointFor(preset: Preset | undefined, given: string | undefined, fail: Input['fail'], resolve?: Resolver): Promise<{ preset: Preset; baseUrl: string }> {
  if (!preset) throw fail(422, 'invalid_preset')
  const policy = { allowPrivate: preset.allowsPrivate }
  try {
    if (preset.base_url) {
      if (given !== undefined && (await checkEndpoint(given, policy, resolve)) !== preset.base_url) throw fail(422, 'invalid_base_url')
      return { preset, baseUrl: preset.base_url }
    }
    if (given === undefined) throw fail(422, 'invalid_base_url')
    return { preset, baseUrl: await checkEndpoint(given, policy, resolve) }
  } catch (error) {
    if (error instanceof EndpointError) throw fail(422, 'invalid_base_url')
    throw error
  }
}

/** The key a request may use: the one it carries, or the stored one when the same preset and endpoint are still chosen. */
function keyFor(preset: Preset, baseUrl: string, given: string | undefined, stored: StoredProvider | null, secret: Buffer | undefined, fail: Input['fail']): string | null {
  if (!preset.needs_api_key) {
    if (given !== undefined) throw fail(422, 'api_key_not_allowed')
    return null
  }
  if (given !== undefined) return given
  if (stored?.sealed && stored.preset === preset.id && (stored.baseUrl ?? preset.base_url) === baseUrl) {
    if (!secret) throw fail(503, 'secret_key_unavailable')
    return openKey(secret, stored.sealed)
  }
  return null
}

/**
 * Whether the stream is asked for token counts: the catalog's answer, unless the preset lets the vendor tick it (then the
 * request's, else the saved choice for the same preset, else the default). A request that contradicts a fixed preset is refused.
 */
function usageFor(preset: Preset, requested: boolean | undefined, stored: StoredProvider | null, fail: Input['fail']): boolean {
  if (!preset.stream_usage_editable) {
    if (requested !== undefined && requested !== preset.stream_usage) throw fail(422, 'invalid_stream_usage')
    return preset.stream_usage
  }
  return requested ?? (stored?.preset === preset.id ? stored.streamUsage : preset.stream_usage)
}

const needSecret = (config: Config, fail: Input['fail']): Buffer => {
  if (!config.admin) throw fail(503, 'secret_key_unavailable')
  return config.admin.secretKey
}

/** One audit entry of a call that sends a key to a provider or lists its models: which preset and host, and the outcome. Never the key. */
async function auditProbe(pool: Pool, actor: number, action: string, reason: string, preset: string, baseUrl: string | undefined, outcome: string): Promise<void> {
  let host: string | null = null
  try { host = baseUrl ? new URL(baseUrl).host : null } catch { /* a malformed endpoint has no host to record */ }
  await pool.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5)', [actorName({ id: actor }), action, SUBJECT, reason, { preset, host, outcome }])
}

/**
 * The platform AI provider the vendor chooses (spec 2026-11-04 §6.13): presets, model list, a connection test and the save
 * that writes the file the shared AI service reads. Returns null when the route is outside this resource. Every route
 * needs `vendor.ai.manage` (owner only by default; a passkey-confirmed capability, so a write or a call that sends the key
 * out needs a fresh confirmation). Models and test calls are audited, with the preset, the host and the outcome.
 */
export async function aiProviderHttp(pool: Pool, config: Config, input: Input, deps: AiProviderDeps = {}): Promise<Result | null> {
  const { method, pathname, auth, fail } = input
  const route = pathname === ROOT ? '' : pathname.startsWith(`${ROOT}/`) ? pathname.slice(ROOT.length + 1) : null
  if (route === null) return null
  const known: Record<string, string> = { '': 'GET,PATCH', presets: 'GET', models: 'POST', test: 'POST' }
  if (!(route in known) || !known[route]!.split(',').includes(method)) throw fail(404, 'not_found')
  input.requireCapability(auth, 'vendor.ai.manage')

  if (route === 'presets') return { status: 200, data: aiProviderPresetListSchema.parse({ items: PRESETS.map(publicPreset), total: PRESETS.length }) }

  if (route === '') {
    if (method === 'GET') {
      const stored = await readProvider(pool)
      return { status: 200, data: aiProviderCurrentSchema.parse({ setting: stored ? await settingOf(stored, config.aiPlatformProviderPath) : null }) }
    }
    return { status: 200, data: await save(pool, config, input, deps) }
  }

  const request = body(route === 'models' ? aiProviderModelsRequestSchema : aiProviderTestRequestSchema, input.raw, fail)
  const action = route === 'models' ? 'ai.platform_provider.models_listed' : 'ai.platform_provider.tested'
  const reason = route === 'models' ? 'Models listed' : 'Connection tested'
  let endpoint: { preset: Preset; baseUrl: string }
  try { endpoint = await endpointFor(findPreset(request.preset), request.base_url, fail, deps.resolve) }
  catch (error) {
    await auditProbe(pool, auth.actor, action, reason, request.preset, request.base_url, (error as { code?: string }).code ?? 'invalid')
    throw error
  }
  const { preset, baseUrl } = endpoint
  const audited = <T>(outcome: string, result: T): Promise<T> => auditProbe(pool, auth.actor, action, reason, preset.id, baseUrl, outcome).then(() => result)
  const stored = await readProvider(pool)
  const apiKey = keyFor(preset, baseUrl, request.api_key, stored, config.admin?.secretKey, fail)
  const streamUsage = usageFor(preset, (request as { stream_usage?: boolean }).stream_usage, stored, fail)
  const target: ProbeTarget = { preset, baseUrl, apiKey, streamUsage }
  if (preset.needs_api_key && !apiKey) {
    if (route === 'models') { await audited('api_key_required', null); throw fail(422, 'api_key_required') }
    return audited('key_missing', { status: 200, data: aiProviderTestResultSchema.parse({ ok: false, code: 'key_missing' }) })
  }
  const fetcher: Fetcher = deps.fetch ?? guardedFetcher({ allowPrivate: preset.allowsPrivate }, { resolve: deps.resolve })
  try {
    if (route === 'models') {
      const ids = await listModels(fetcher, target)
      return audited('ok', { status: 200, data: aiProviderModelsSchema.parse({ items: ids.map(id => ({ id })), total: ids.length }) })
    }
    const outcome = await testCompletion(fetcher, target, (request as z.infer<typeof aiProviderTestRequestSchema>).model)
    return audited(outcome.usageReported ? 'ok' : 'ok_without_usage', { status: 200, data: aiProviderTestResultSchema.parse({ ok: true, latency_ms: outcome.latencyMs, usage_reported: outcome.usageReported }) })
  } catch (error) {
    if (!(error instanceof ProviderCallError)) throw error
    await audited(error.code, null)
    // The code is the whole answer: neither the provider's message nor the key leaves the control plane.
    if (route === 'test') return { status: 200, data: aiProviderTestResultSchema.parse({ ok: false, code: error.code }) }
    throw fail(error.code === 'unauthorized' || error.code === 'endpoint_refused' ? 422 : 502, error.code === 'provider_error' ? error.code : `provider_${error.code}`)
  }
}

/**
 * The save: row, audit entry and file change in one transaction under the save lock. The audit entry is written before the
 * file, and the file is the last step before COMMIT; if the commit (or anything after the rename) fails, the previous file
 * content is put back, so a failed save leaves the row, the audit trail and the file as they were.
 */
async function save(pool: Pool, config: Config, input: Input, deps: AiProviderDeps): Promise<unknown> {
  const { auth, fail } = input
  const request = body(aiProviderSaveSchema, input.raw, fail)
  const { preset, baseUrl } = await endpointFor(findPreset(request.preset), request.base_url, fail, deps.resolve)
  const secret = request.api_key !== undefined ? needSecret(config, fail) : config.admin?.secretKey
  const client: PoolClient = await pool.connect()
  const file: { restore: (() => Promise<void>) | null } = { restore: null }
  let saved: Omit<StoredProvider, 'updatedAt'>
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [AI_PROVIDER_SAVE_LOCK])
    const stored = await readProvider(client, true)
    const apiKey = keyFor(preset, baseUrl, request.api_key, stored, secret, fail)
    if (preset.needs_api_key && !apiKey) throw fail(422, 'api_key_required')
    const streamUsage = usageFor(preset, request.stream_usage, stored, fail)
    let sealed: Buffer | null = null
    let last4: string | null = null
    if (apiKey) {
      if (request.api_key !== undefined) { sealed = sealKey(secret!, apiKey); last4 = apiKey.slice(-LAST_CHARS) } else { sealed = stored!.sealed; last4 = stored!.last4 }
    }
    const next: Omit<StoredProvider, 'updatedAt'> = {
      preset: preset.id, provider: preset.provider, model: request.model, baseUrl: preset.named ? null : (preset.base_url ?? baseUrl), streamUsage,
      sealed, last4, revision: (stored?.revision ?? 0) + 1, updatedBy: actorName({ id: auth.actor }),
    }
    await writeProvider(client, next)
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5)', [
      actorName({ id: auth.actor }), 'ai.platform_provider.saved', SUBJECT, request.reason,
      { preset: preset.id, provider: preset.provider, model: request.model, base_url: next.baseUrl, stream_usage: streamUsage, revision: next.revision, key_changed: request.api_key !== undefined, delivered: Boolean(config.aiPlatformProviderPath) },
    ])
    if (config.aiPlatformProviderPath) {
      try { file.restore = await replaceProviderFile(config.aiPlatformProviderPath, providerFileContent(next, apiKey)) } catch { throw fail(503, 'provider_file_unavailable') }
    }
    await client.query('COMMIT')
    saved = next
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* the connection is gone; the server rolls the transaction back */ }
    if (file.restore) await file.restore().catch(() => undefined)
    throw error
  } finally { client.release() }
  return aiProviderCurrentSchema.parse({ setting: aiProviderSettingSchema.parse(await settingOf({ ...saved, updatedAt: new Date() }, config.aiPlatformProviderPath)) })
}
