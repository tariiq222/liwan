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
import {
  AI_PROVIDER_SAVE_LOCK, isComplete, openKey, providerFileContent, readConfig, recordUsageReported, replaceProviderFile, routeRows, sealKey, settingOf, writeConfig,
  type NewConfig, type StoredConfig, type StoredProvider,
} from './store.js'

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
    if (error instanceof EndpointError) throw fail(422, error.code === 'base_url_port' ? 'invalid_base_url_port' : 'invalid_base_url')
    throw error
  }
}

/** The key a provider may use: the one the request carries, or the stored one of the same provider id when the same preset and endpoint are still chosen. */
function keyFor(preset: Preset, baseUrl: string, given: string | undefined, stored: StoredProvider | undefined, secret: Buffer | undefined, fail: Input['fail']): string | null {
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
function usageFor(preset: Preset, requested: boolean | undefined, stored: StoredProvider | undefined, fail: Input['fail']): boolean {
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

/** One audit entry of a call that sends a key to a provider or lists its models: which provider, preset and host, the model tested, and the outcome. Never the key. */
async function auditProbe(pool: Pool, actor: number, action: string, reason: string, meta: { provider: string; preset: string; baseUrl: string | undefined; model?: string }, outcome: string): Promise<void> {
  let host: string | null = null
  try { host = meta.baseUrl ? new URL(meta.baseUrl).host : null } catch { /* a malformed endpoint has no host to record */ }
  await pool.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5)', [
    actorName({ id: actor }), action, SUBJECT, reason, { provider: meta.provider, preset: meta.preset, host, ...(meta.model ? { model: meta.model } : {}), outcome },
  ])
}

/**
 * The platform AI configuration the vendor chooses (specs 2026-11-04 §6.13, 2026-11-10 §5.5): presets, the whole configuration
 * (providers, priced models, margin, routes), a model list and a connection test per saved provider, and the save that writes the
 * file the shared AI service reads. Returns null when the route is outside this resource. Every route needs `vendor.ai.manage`
 * (owner only by default; a passkey-confirmed capability, so a write or a call that sends a key out needs a fresh confirmation).
 * Models and test calls are audited, with the provider, the preset, the host and the outcome.
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
      const stored = await readConfig(pool)
      return { status: 200, data: aiProviderCurrentSchema.parse({ setting: stored ? await settingOf(stored, config.aiPlatformProviderPath) : null }) }
    }
    return { status: 200, data: await save(pool, config, input, deps) }
  }

  const request = body(route === 'models' ? aiProviderModelsRequestSchema : aiProviderTestRequestSchema, input.raw, fail)
  const action = route === 'models' ? 'ai.platform_provider.models_listed' : 'ai.platform_provider.tested'
  const reason = route === 'models' ? 'Models listed' : 'Connection tested'
  const stored = (await readConfig(pool))?.providers.find(provider => provider.id === request.provider)
  if (!stored) throw fail(422, 'unknown_provider')
  const model = (request as z.infer<typeof aiProviderTestRequestSchema>).model
  const meta = { provider: stored.id, preset: stored.preset, baseUrl: stored.baseUrl ?? findPreset(stored.preset)?.base_url ?? undefined, ...(route === 'test' ? { model } : {}) }
  let endpoint: { preset: Preset; baseUrl: string }
  try { endpoint = await endpointFor(findPreset(stored.preset), stored.baseUrl ?? undefined, fail, deps.resolve) }
  catch (error) {
    await auditProbe(pool, auth.actor, action, reason, meta, (error as { code?: string }).code ?? 'invalid')
    throw error
  }
  const { preset, baseUrl } = endpoint
  const audited = <T>(outcome: string, result: T): Promise<T> => auditProbe(pool, auth.actor, action, reason, { ...meta, baseUrl }, outcome).then(() => result)
  const apiKey = keyFor(preset, baseUrl, undefined, stored, config.admin?.secretKey, fail)
  const target: ProbeTarget = { preset, baseUrl, apiKey, streamUsage: stored.streamUsage }
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
    const outcome = await testCompletion(fetcher, target, model)
    await recordUsageReported(pool, { providerId: stored.id, preset: stored.preset, baseUrl: stored.baseUrl, streamUsage: stored.streamUsage, model }, outcome.usageReported)
    return audited(outcome.usageReported ? 'ok' : 'ok_without_usage', { status: 200, data: aiProviderTestResultSchema.parse({ ok: true, latency_ms: outcome.latencyMs, usage_reported: outcome.usageReported }) })
  } catch (error) {
    if (!(error instanceof ProviderCallError)) throw error
    await audited(error.code, null)
    // The code is the whole answer: neither the provider's message nor the key leaves the control plane.
    if (route === 'test') return { status: 200, data: aiProviderTestResultSchema.parse({ ok: false, code: error.code }) }
    throw fail(error.code === 'unauthorized' || error.code === 'endpoint_refused' ? 422 : 502, error.code === 'provider_error' ? error.code : `provider_${error.code}`)
  }
}

/** The rules a configuration must meet before any row is written; each failure is a stable 422 code. */
async function validated(request: z.infer<typeof aiProviderSaveSchema>, stored: StoredConfig | null, secret: Buffer | undefined, input: Input, deps: AiProviderDeps): Promise<{
  providers: StoredProvider[]; keys: Map<string, string | null>; models: NewConfig['models']; keyChanges: number
}> {
  const { fail } = input
  const storedProviders = new Map((stored?.providers ?? []).map(provider => [provider.id, provider]))
  const providers: StoredProvider[] = []
  const keys = new Map<string, string | null>()
  let keyChanges = 0
  for (const [id, entry] of Object.entries(request.providers)) {
    const { preset, baseUrl } = await endpointFor(findPreset(entry.preset), entry.base_url, fail, deps.resolve)
    const previous = storedProviders.get(id)
    const apiKey = keyFor(preset, baseUrl, entry.api_key, previous, secret, fail)
    if (preset.needs_api_key && !apiKey) throw fail(422, 'api_key_required')
    const streamUsage = usageFor(preset, entry.stream_usage, previous, fail)
    let sealed: Buffer | null = null
    let last4: string | null = null
    if (apiKey) {
      if (entry.api_key !== undefined) { sealed = sealKey(secret!, apiKey); last4 = apiKey.slice(-LAST_CHARS); keyChanges += 1 } else { sealed = previous!.sealed; last4 = previous!.last4 }
    }
    keys.set(id, apiKey)
    providers.push({ id, preset: preset.id, provider: preset.provider, baseUrl: preset.named ? null : (preset.base_url ?? baseUrl), streamUsage, sealed, last4 })
  }
  const byId = new Map(providers.map(provider => [provider.id, provider]))
  const storedModels = new Map((stored?.models ?? []).map(model => [model.id, model]))
  const models: NewConfig['models'] = Object.entries(request.models).map(([id, entry]) => {
    const provider = byId.get(entry.provider)
    if (!provider) throw fail(422, 'unknown_provider')
    const previous = storedModels.get(id)
    const before = previous && storedProviders.get(previous.providerId)
    // A test result holds while the model and the provider's endpoint and token-count option are the ones it was made with.
    const keepUsageReported = Boolean(previous && before && previous.providerId === entry.provider && previous.model === entry.model
      && before.preset === provider.preset && before.baseUrl === provider.baseUrl && before.streamUsage === provider.streamUsage)
    return { id, providerId: entry.provider, model: entry.model, inputPrice: entry.input_price ?? null, cachedInputPrice: entry.cached_input_price ?? null, outputPrice: entry.output_price ?? null, keepUsageReported }
  })
  const modelsById = new Map(models.map(model => [model.id, model]))
  for (const [, , modelId] of routeRows(request.routes)) if (!modelsById.has(modelId)) throw fail(422, 'unknown_model')
  // Once a default model has been delivered, a save that drops it would leave the service silently on the old file.
  if (!request.routes.default && stored && isComplete(stored)) throw fail(422, 'default_required')
  // The rule guards changes, not existing state: a route that is new, or points at another model, or at a model whose name or provider
  // endpoint changed (which resets its test result), must reach a priced model whose last test saw token counts (spec 2026-11-10 §4).
  // A route unchanged from the stored configuration is accepted as it is: a configuration carried forward from the single-provider
  // table keeps its unpriced default (its calls are not charged) until the vendor switches the default to a model that passes.
  const storedRoutes = new Set(routeRows(stored?.routes ?? {}).map(row => row.join('|')))
  for (const row of routeRows(request.routes)) {
    const model = modelsById.get(row[2])!
    if (storedRoutes.has(row.join('|')) && model.keepUsageReported) continue
    if (model.inputPrice === null || model.outputPrice === null) throw fail(422, 'model_not_priced')
    if (!model.keepUsageReported || !storedModels.get(row[2])?.usageReported) throw fail(422, 'model_not_tested')
  }
  return { providers, keys, models, keyChanges }
}

/**
 * The save: rows, audit entry and file change in one transaction under the session-level save lock. The audit entry is written before the
 * file, and the file is the last step before COMMIT; if the commit (or anything after the rename) fails, the previous file
 * content is put back, so a failed save leaves the rows, the audit trail and the file as they were. The file is written only for a
 * configuration that routes a default model; without one the answer says `incomplete` and the service keeps the file it has.
 */
async function save(pool: Pool, config: Config, input: Input, deps: AiProviderDeps): Promise<unknown> {
  const { auth, fail } = input
  const request = body(aiProviderSaveSchema, input.raw, fail)
  const hasKey = Object.values(request.providers).some(provider => provider.api_key !== undefined)
  const secret = hasKey ? needSecret(config, fail) : config.admin?.secretKey
  const client: PoolClient = await pool.connect()
  let broken = false
  let locked = false
  const file: { restore: (() => Promise<void>) | null } = { restore: null }
  let saved: StoredConfig
  try {
    // A session-level lock, taken before the transaction and released only after the file is restored: a transaction-level one would be
    // released by ROLLBACK while the restore is still to come, and a waiting save could commit and then be overwritten by the late restore.
    await client.query('SELECT pg_advisory_lock($1)', [AI_PROVIDER_SAVE_LOCK])
    locked = true
    await client.query('BEGIN')
    const stored = await readConfig(client, true)
    const checked = await validated(request, stored, secret, input, deps)
    const next: NewConfig = {
      revision: (stored?.revision ?? 0) + 1, marginBps: request.margin_bps, updatedBy: actorName({ id: auth.actor }),
      providers: checked.providers, models: checked.models, routes: request.routes,
    }
    await writeConfig(client, next)
    const complete = isComplete(next)
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5)', [
      actorName({ id: auth.actor }), 'ai.platform_provider.saved', SUBJECT, request.reason,
      {
        revision: next.revision, margin_bps: next.marginBps, providers: next.providers.length, models: next.models.length, routes: routeRows(next.routes).length,
        key_changed: checked.keyChanges > 0, keys_changed: checked.keyChanges, delivered: Boolean(config.aiPlatformProviderPath) && complete, complete,
      },
    ])
    saved = (await readConfig(client))!
    if (config.aiPlatformProviderPath && complete) {
      try { file.restore = await replaceProviderFile(config.aiPlatformProviderPath, providerFileContent(saved, checked.keys)) } catch { throw fail(503, 'provider_file_unavailable') }
    }
    await client.query('COMMIT')
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* the connection is gone; the server rolls the transaction back */ }
    if (file.restore) await file.restore().catch(() => undefined)
    throw error
  } finally {
    if (locked) { try { await client.query('SELECT pg_advisory_unlock($1)', [AI_PROVIDER_SAVE_LOCK]) } catch { broken = true } }  // a connection that cannot unlock is discarded: ending the session frees the lock
    client.release(broken)
  }
  return aiProviderCurrentSchema.parse({ setting: aiProviderSettingSchema.parse(await settingOf(saved, config.aiPlatformProviderPath)) })
}
