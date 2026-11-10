import { randomUUID } from 'node:crypto'
import { chmod, open, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import type { Pool, PoolClient } from 'pg'
import { AI_QUALITY_LEVELS, type AiCapability, type AiProviderName, type AiProviderSetting, type AiQuality, type AiRoutes } from '@liwan/commercial-contracts'
import { open as openBox, seal } from '../admin-auth/crypto.js'

type Db = Pick<Pool, 'query'> | PoolClient

/** A provider row of the configuration. `sealed` is the key under the control plane's admin secret; nothing returns it to a caller. */
export type StoredProvider = { id: string; preset: string; provider: AiProviderName; baseUrl: string | null; streamUsage: boolean; sealed: Buffer | null; last4: string | null }
/** A model row. Prices are plain decimals in USD per million tokens, as the database returns them. */
export type StoredModel = { id: string; providerId: string; model: string; inputPrice: string | null; cachedInputPrice: string | null; outputPrice: string | null; usageReported: boolean }
/** The whole configuration: the single config row, every provider and model, and the routes (`default` and, per quality level, a model per capability). */
export type StoredConfig = {
  revision: number; marginBps: number; updatedBy: string; updatedAt: Date
  providers: StoredProvider[]; models: StoredModel[]; routes: AiRoutes
}
/** What a save writes: a model's `keepUsageReported` says whether the stored test result still holds for it (same provider endpoint, same model name). */
export type NewConfig = {
  revision: number; marginBps: number; updatedBy: string
  providers: StoredProvider[]; models: Array<Omit<StoredModel, 'usageReported'> & { keepUsageReported: boolean }>; routes: AiRoutes
}

/** One saver at a time across control-plane processes: the rows, the audit entry and the file change together. A single-bigint advisory key of its own (see the list in usage-collector.ts). */
export const AI_PROVIDER_SAVE_LOCK = 1397969236

const KEY_AAD = Buffer.from('ai-platform-provider|api_key')
const FILE_MODE = 0o640  // the ai user reads it through the directory's group; no other user
const DEFAULT = 'default'

export const sealKey = (secret: Buffer, apiKey: string): Buffer => seal(secret, Buffer.from(apiKey, 'utf8'), KEY_AAD)
export const openKey = (secret: Buffer, box: Buffer): string => openBox(secret, box, KEY_AAD).toString('utf8')

const price = (value: string | null): string | null => (value === null ? null : normalizePrice(value))
/** `2.50000` as `2.5`, `10.00000` as `10`: the form the file and the answers carry. */
export const normalizePrice = (value: string): string => (value.includes('.') ? value.replace(/\.?0+$/, '') : value)

export async function readConfig(db: Db, lock = false): Promise<StoredConfig | null> {
  const config = (await db.query(`SELECT revision, margin_bps, updated_by, updated_at FROM ai_provider_config WHERE singleton${lock ? ' FOR UPDATE' : ''}`)).rows[0]
  if (!config) return null
  const providers = (await db.query('SELECT id, preset, provider, base_url, stream_usage, api_key_sealed, api_key_last4 FROM ai_provider ORDER BY id')).rows
  const models = (await db.query('SELECT id, provider_id, model, input_price, cached_input_price, output_price, usage_reported FROM ai_model ORDER BY id')).rows
  const routes: AiRoutes = {}
  for (const row of (await db.query('SELECT quality, capability, model_id FROM ai_route ORDER BY quality, capability')).rows) {
    if (row.quality === DEFAULT) routes.default = row.model_id
    else (routes[row.quality as AiQuality] ??= {})[row.capability as AiCapability] = row.model_id
  }
  return {
    revision: config.revision, marginBps: config.margin_bps, updatedBy: config.updated_by, updatedAt: config.updated_at, routes,
    providers: providers.map(row => ({ id: row.id, preset: row.preset, provider: row.provider, baseUrl: row.base_url, streamUsage: row.stream_usage, sealed: row.api_key_sealed, last4: row.api_key_last4 })),
    models: models.map(row => ({ id: row.id, providerId: row.provider_id, model: row.model, inputPrice: price(row.input_price), cachedInputPrice: price(row.cached_input_price), outputPrice: price(row.output_price), usageReported: row.usage_reported })),
  }
}

/** The (quality, capability, model id) rows of a set of routes; the default model is the row ('default', 'default'). */
export function routeRows(routes: AiRoutes): Array<[string, string, string]> {
  const rows: Array<[string, string, string]> = routes.default ? [[DEFAULT, DEFAULT, routes.default]] : []
  for (const quality of AI_QUALITY_LEVELS) for (const [capability, modelId] of Object.entries(routes[quality] ?? {})) if (modelId) rows.push([quality, capability, modelId])
  return rows
}

/** Replace the whole configuration: rows no longer named go, the others are updated in place so a model keeps its test result when it still holds. */
export async function writeConfig(db: Db, next: NewConfig): Promise<void> {
  const providerIds = next.providers.map(provider => provider.id)
  const modelIds = next.models.map(model => model.id)
  await db.query('DELETE FROM ai_route')
  await db.query('DELETE FROM ai_model WHERE id <> ALL($1::text[])', [modelIds])
  await db.query('DELETE FROM ai_provider WHERE id <> ALL($1::text[])', [providerIds])
  for (const provider of next.providers) {
    await db.query(
      `INSERT INTO ai_provider(id, preset, provider, base_url, stream_usage, api_key_sealed, api_key_last4) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET preset=$2, provider=$3, base_url=$4, stream_usage=$5, api_key_sealed=$6, api_key_last4=$7`,
      [provider.id, provider.preset, provider.provider, provider.baseUrl, provider.streamUsage, provider.sealed, provider.last4],
    )
  }
  for (const model of next.models) {
    await db.query(
      `INSERT INTO ai_model(id, provider_id, model, input_price, cached_input_price, output_price) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET provider_id=$2, model=$3, input_price=$4, cached_input_price=$5, output_price=$6,
         usage_reported = CASE WHEN $7 THEN ai_model.usage_reported ELSE false END`,
      [model.id, model.providerId, model.model, model.inputPrice, model.cachedInputPrice, model.outputPrice, model.keepUsageReported],
    )
  }
  for (const [quality, capability, modelId] of routeRows(next.routes)) await db.query('INSERT INTO ai_route(quality, capability, model_id) VALUES($1,$2,$3)', [quality, capability, modelId])
  await db.query(
    `INSERT INTO ai_provider_config(singleton, revision, margin_bps, updated_by, updated_at) VALUES(true,$1,$2,$3,now())
     ON CONFLICT (singleton) DO UPDATE SET revision=$1, margin_bps=$2, updated_by=$3, updated_at=now()`,
    [next.revision, next.marginBps, next.updatedBy],
  )
}

/** What a test was made against: the provider as it was then, and the model name. */
export type TestedModel = { providerId: string; preset: string; baseUrl: string | null; streamUsage: boolean; model: string }

/**
 * Record what a successful test saw, under the save lock and only if the provider's preset, endpoint and token-count option and
 * the model name are still the ones the test used (a save may have changed them while the provider was answering).
 */
export async function recordUsageReported(pool: Pool, tested: TestedModel, usageReported: boolean): Promise<boolean> {
  const client = await pool.connect()
  let broken = false
  try {
    await client.query('SELECT pg_advisory_lock($1)', [AI_PROVIDER_SAVE_LOCK])
    try {
      const result = await client.query(
        `UPDATE ai_model SET usage_reported=$6 WHERE provider_id=$1 AND model=$2
           AND EXISTS (SELECT 1 FROM ai_provider p WHERE p.id=$1 AND p.preset=$3 AND p.base_url IS NOT DISTINCT FROM $4 AND p.stream_usage=$5)`,
        [tested.providerId, tested.model, tested.preset, tested.baseUrl, tested.streamUsage, usageReported],
      )
      return (result.rowCount ?? 0) > 0
    } finally {
      try { await client.query('SELECT pg_advisory_unlock($1)', [AI_PROVIDER_SAVE_LOCK]) } catch { broken = true }
    }
  } finally { client.release(broken) }
}

/** The model ids a configuration routes, once each. */
export const routedModelIds = (routes: AiRoutes): string[] => [...new Set(routeRows(routes).map(([, , modelId]) => modelId))]

/** Whether a stored configuration can be written to the file the AI service reads: it routes a default model. */
export const isComplete = (config: Pick<StoredConfig, 'routes'>): boolean => Boolean(config.routes.default)

/**
 * The JSON the AI service reads (apps/ai-service platform_provider.py): the providers the routed models use, the routed models
 * with their prices, the margin and the routes. The keys are in it, so the file is mode 640 in a directory only the service's
 * group enters. `keys` holds each provider's plain key, or null.
 */
export function providerFileContent(config: Pick<StoredConfig, 'revision' | 'marginBps' | 'providers' | 'models' | 'routes'>, keys: ReadonlyMap<string, string | null>): string {
  const routed = new Set(routedModelIds(config.routes))
  const models = config.models.filter(model => routed.has(model.id))
  const used = new Set(models.map(model => model.providerId))
  const providers = config.providers.filter(provider => used.has(provider.id))
  // Anthropic and Ollama report token counts on their own, so the flag is written only for the providers whose stream must be asked.
  const asksForUsage = (provider: AiProviderName) => ['openai', 'openai_compatible', 'openrouter'].includes(provider)
  const routes: Record<string, unknown> = { default: config.routes.default }
  for (const quality of AI_QUALITY_LEVELS) if (config.routes[quality] && Object.keys(config.routes[quality]!).length) routes[quality] = config.routes[quality]
  return JSON.stringify({
    revision: config.revision,
    margin_bps: config.marginBps,
    providers: Object.fromEntries(providers.map((provider) => {
      const apiKey = keys.get(provider.id)
      return [provider.id, {
        provider: provider.provider, ...(provider.baseUrl ? { base_url: provider.baseUrl } : {}), ...(apiKey ? { api_key: apiKey } : {}),
        ...(asksForUsage(provider.provider) ? { stream_usage: provider.streamUsage } : {}),
      }]
    })),
    models: Object.fromEntries(models.map(model => [model.id, {
      provider: model.providerId, model: model.model, ...(model.inputPrice !== null ? { input_price: model.inputPrice } : {}),
      ...(model.cachedInputPrice !== null ? { cached_input_price: model.cachedInputPrice } : {}), ...(model.outputPrice !== null ? { output_price: model.outputPrice } : {}),
    }])),
    routes,
  })
}

const STALE_TEMPORARY = /^\.platform-provider\..+\.tmp$/

async function putAtomically(path: string, content: string): Promise<void> {
  const temporary = `${dirname(path)}/.platform-provider.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', FILE_MODE)
  try {
    try { await file.writeFile(content); await file.sync() } finally { await file.close() }
    await chmod(temporary, FILE_MODE)  // the umask may have narrowed the mode at creation
    await rename(temporary, path)
  } catch (error) { await unlink(temporary).catch(() => undefined); throw error }
  const directory = await open(dirname(path), 'r')
  try { await directory.sync() } finally { await directory.close() }
}

/**
 * Replace the file the AI service reads, atomically (a temporary file in the same directory, then a rename), and return the
 * function that puts the previous content back (or removes the file when there was none). Temporary files a crashed
 * earlier write left behind are removed first (saves are serialized by the save lock, so none is in use). If anything after
 * the rename fails, the previous content is restored before the error is rethrown; the caller calls the returned function
 * when a later step (the commit) fails.
 */
export async function replaceProviderFile(path: string, content: string): Promise<() => Promise<void>> {
  if (!isAbsolute(path)) throw new Error('ai_platform_provider_path_invalid')
  for (const name of await readdir(dirname(path))) if (STALE_TEMPORARY.test(name)) await unlink(`${dirname(path)}/${name}`).catch(() => undefined)
  const previous = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
  const restore = async () => { if (previous === null) await unlink(path).catch(() => undefined); else await putAtomically(path, previous) }
  try { await putAtomically(path, content) } catch (error) { await restore().catch(() => undefined); throw error }
  return restore
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether the file the AI service reads is in the current shape and holds the revision this configuration has. */
export async function deliveryOf(path: string | undefined, config: Pick<StoredConfig, 'revision' | 'routes'>): Promise<AiProviderSetting['delivery']> {
  if (!path) return 'unconfigured'
  if (!isComplete(config)) return 'incomplete'
  try {
    const written: unknown = JSON.parse(await readFile(path, 'utf8'))
    return isObject(written) && isObject(written.providers) && isObject(written.models) && isObject(written.routes) && written.revision === config.revision ? 'delivered' : 'pending'
  } catch { return 'pending' }
}

/** The vendor's view: what is chosen, per provider the last four characters of its key, and whether the service has it. */
export async function settingOf(config: StoredConfig, path: string | undefined): Promise<AiProviderSetting> {
  return {
    revision: config.revision, margin_bps: config.marginBps,
    providers: Object.fromEntries(config.providers.map(provider => [provider.id, {
      preset: provider.preset, provider: provider.provider, base_url: provider.baseUrl, stream_usage: provider.streamUsage, key: { configured: provider.sealed !== null, last4: provider.last4 },
    }])),
    models: Object.fromEntries(config.models.map(model => [model.id, {
      provider: model.providerId, model: model.model, input_price: model.inputPrice, cached_input_price: model.cachedInputPrice, output_price: model.outputPrice, usage_reported: model.usageReported,
    }])),
    routes: config.routes, updated_at: config.updatedAt.toISOString(), updated_by: config.updatedBy, delivery: await deliveryOf(path, config),
  }
}
