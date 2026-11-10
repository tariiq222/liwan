import { readFile } from 'node:fs/promises'
import type { Pool } from 'pg'
import type { Config } from '../config.js'
import { AI_PROVIDER_SAVE_LOCK, isComplete, openKey, providerFileContent, readConfig, replaceProviderFile } from './store.js'

export type SyncOutcome = 'written' | 'unchanged' | 'incomplete' | 'unconfigured' | 'failed'

/**
 * At start, after the migrations: make the file the AI service reads match the stored configuration, so an upgrade never leaves the
 * service on a file in an older shape. It writes only a complete configuration (a default route) and only when the file is missing or
 * differs from what a save would render. This is not a vendor save: the "priced and tested" rule does not apply, so the provider
 * carried forward from the single-provider table keeps working, uncharged. A failure is logged by name and never stops the start.
 */
export async function syncProviderFile(pool: Pool, config: Config): Promise<SyncOutcome> {
  const path = config.aiPlatformProviderPath
  if (!path) return 'unconfigured'
  const client = await pool.connect()
  let broken = false
  try {
    await client.query('SELECT pg_advisory_lock($1)', [AI_PROVIDER_SAVE_LOCK])
    try {
      const stored = await readConfig(client)
      if (!stored || !isComplete(stored)) return 'incomplete'
      const keys = new Map<string, string | null>()
      for (const provider of stored.providers) {
        if (provider.sealed && !config.admin) throw new Error('secret_key_unavailable')
        keys.set(provider.id, provider.sealed ? openKey(config.admin!.secretKey, provider.sealed) : null)
      }
      const content = providerFileContent(stored, keys)
      const current = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
      if (current === content) return 'unchanged'
      await replaceProviderFile(path, content)
      return 'written'
    } finally {
      try { await client.query('SELECT pg_advisory_unlock($1)', [AI_PROVIDER_SAVE_LOCK]) } catch { broken = true }
    }
  } catch (error) {
    console.error(`[control-plane] the AI platform provider file was not synced: ${(error as Error).message}`)
    return 'failed'
  } finally { client.release(broken) }
}
