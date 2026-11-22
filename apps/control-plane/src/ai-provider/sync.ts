import { readFile } from 'node:fs/promises'
import type { Pool } from 'pg'
import type { AiProviderSetting } from '@liwan/commercial-contracts'
import type { Config } from '../config.js'
import { AI_PROVIDER_SAVE_LOCK, deliveryOf, isComplete, openKey, providerFileContent, readConfig, replaceProviderFile, type StoredConfig } from './store.js'
import { logText } from '../log-text.js'

export type DeliveryOutcome = 'written' | 'unchanged'
export type SyncOutcome = DeliveryOutcome | 'incomplete' | 'unconfigured' | 'failed'

/** Why the stored configuration was not delivered, as the stable code the route answers with. */
export type DeliveryRefusal = 'provider_incomplete' | 'provider_file_unconfigured' | 'secret_key_unavailable' | 'provider_file_unavailable'
/** `revision` and `before` (the delivery state when the call began) are for the audit entry; no stored configuration has no revision and counts as incomplete. */
export class DeliveryError extends Error {
  constructor(readonly code: DeliveryRefusal, readonly revision: number | null, readonly before: AiProviderSetting['delivery'], cause?: unknown) {
    super(code, { cause })
  }
}
/** A sealed key as plain text; one the control plane has no secret for, or cannot decrypt with it, is `secret_key_unavailable`. */
function openSealedKey(config: Config, sealed: Buffer, revision: number | null, before: AiProviderSetting['delivery']): string {
  if (!config.admin) throw new DeliveryError('secret_key_unavailable', revision, before)
  try { return openKey(config.admin.secretKey, sealed) } catch (error) { throw new DeliveryError('secret_key_unavailable', revision, before, error) }
}
export type Delivered = { outcome: DeliveryOutcome; stored: StoredConfig; before: AiProviderSetting['delivery'] }

/**
 * Make the file the AI service reads match the stored configuration: the one place that renders and writes it outside a save. Under the
 * save lock (the one a save and a test result take) it reads the configuration, renders it as a save would, and replaces the file only
 * when it is missing or differs. It is not a vendor save: the "priced and tested" rule does not apply, so what a save already accepted
 * (including the provider carried forward from the single-provider table, uncharged) is delivered as it is, and nothing routed changes.
 * It throws a `DeliveryError`; the file is replaced atomically and a failed write leaves the previous file in place.
 */
export async function deliverProviderFile(pool: Pool, config: Config): Promise<Delivered> {
  const path = config.aiPlatformProviderPath
  const client = await pool.connect()
  let broken = false
  try {
    await client.query('SELECT pg_advisory_lock($1)', [AI_PROVIDER_SAVE_LOCK])
    try {
      const stored = await readConfig(client)
      const before = stored ? await deliveryOf(path, stored) : 'incomplete'
      const revision = stored?.revision ?? null
      if (!path) throw new DeliveryError('provider_file_unconfigured', revision, before)
      if (!stored || !isComplete(stored)) throw new DeliveryError('provider_incomplete', revision, before)
      const keys = new Map<string, string | null>()
      for (const provider of stored.providers) {
        keys.set(provider.id, provider.sealed ? openSealedKey(config, provider.sealed, revision, before) : null)
      }
      const content = providerFileContent(stored, keys)
      try {
        const current = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
        if (current === content) return { outcome: 'unchanged', stored, before }
        await replaceProviderFile(path, content)
      } catch (error) { throw new DeliveryError('provider_file_unavailable', revision, before, error) }
      return { outcome: 'written', stored, before }
    } finally {
      try { await client.query('SELECT pg_advisory_unlock($1)', [AI_PROVIDER_SAVE_LOCK]) } catch { broken = true }
    }
  } finally { client.release(broken) }
}

/**
 * At start, after the migrations: deliver the stored configuration, so an upgrade never leaves the service on a file in an older shape.
 * Only a complete configuration is written. A failure is logged by name and never stops the start.
 */
export async function syncProviderFile(pool: Pool, config: Config): Promise<SyncOutcome> {
  try {
    return (await deliverProviderFile(pool, config)).outcome
  } catch (error) {
    if (error instanceof DeliveryError && error.code === 'provider_file_unconfigured') return 'unconfigured'
    if (error instanceof DeliveryError && error.code === 'provider_incomplete') return 'incomplete'
    console.error('[control-plane] the AI platform provider file was not synced: %s', logText(error instanceof DeliveryError ? error.cause ?? error : error))
    return 'failed'
  }
}
