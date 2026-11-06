import { randomUUID } from 'node:crypto'
import { chmod, open, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import type { Pool, PoolClient } from 'pg'
import type { AiProviderName, AiProviderSetting } from '@liwan/commercial-contracts'
import { open as openBox, seal } from '../admin-auth/crypto.js'

type Db = Pick<Pool, 'query'> | PoolClient

/** The row of ai_platform_provider. `sealed` is the key under the control plane's admin secret; nothing returns it to a caller. */
export type StoredProvider = {
  preset: string; provider: AiProviderName; model: string; baseUrl: string | null; streamUsage: boolean
  sealed: Buffer | null; last4: string | null; revision: number; updatedBy: string; updatedAt: Date
}

/** One saver at a time across control-plane processes: the row, the audit entry and the file change together. A single-bigint advisory key of its own (see the list in usage-collector.ts). */
export const AI_PROVIDER_SAVE_LOCK = 1397969236

const KEY_AAD = Buffer.from('ai-platform-provider|api_key')
const FILE_MODE = 0o640  // the ai user reads it through the directory's group; no other user

export const sealKey = (secret: Buffer, apiKey: string): Buffer => seal(secret, Buffer.from(apiKey, 'utf8'), KEY_AAD)
export const openKey = (secret: Buffer, box: Buffer): string => openBox(secret, box, KEY_AAD).toString('utf8')

export async function readProvider(db: Db, lock = false): Promise<StoredProvider | null> {
  const row = (await db.query(`SELECT preset, provider, model, base_url, stream_usage, api_key_sealed, api_key_last4, revision, updated_by, updated_at FROM ai_platform_provider WHERE singleton${lock ? ' FOR UPDATE' : ''}`)).rows[0]
  return row ? { preset: row.preset, provider: row.provider, model: row.model, baseUrl: row.base_url, streamUsage: row.stream_usage, sealed: row.api_key_sealed, last4: row.api_key_last4, revision: row.revision, updatedBy: row.updated_by, updatedAt: row.updated_at } : null
}

export async function writeProvider(db: Db, next: Omit<StoredProvider, 'updatedAt'>): Promise<void> {
  await db.query(
    `INSERT INTO ai_platform_provider(singleton, preset, provider, model, base_url, stream_usage, api_key_sealed, api_key_last4, revision, updated_by, updated_at)
     VALUES(true, $1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (singleton) DO UPDATE SET preset=$1, provider=$2, model=$3, base_url=$4, stream_usage=$5, api_key_sealed=$6, api_key_last4=$7, revision=$8, updated_by=$9, updated_at=now()`,
    [next.preset, next.provider, next.model, next.baseUrl, next.streamUsage, next.sealed, next.last4, next.revision, next.updatedBy],
  )
}

/** The JSON the AI service reads (apps/ai-service platform_provider.py); the key is in it, so the file is mode 640 in a directory only the service's group enters. */
export function providerFileContent(stored: Pick<StoredProvider, 'provider' | 'model' | 'baseUrl' | 'streamUsage' | 'revision'>, apiKey: string | null): string {
  // Anthropic and Ollama report token counts on their own, so the flag is written only for the providers whose stream must be asked.
  const asksForUsage = ['openai', 'openai_compatible', 'openrouter'].includes(stored.provider)
  return JSON.stringify({
    provider: stored.provider, model: stored.model, ...(stored.baseUrl ? { base_url: stored.baseUrl } : {}), ...(apiKey ? { api_key: apiKey } : {}),
    ...(asksForUsage ? { stream_usage: stored.streamUsage } : {}), revision: stored.revision,
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

/** Whether the file the AI service reads holds the revision this row has. */
export async function deliveryOf(path: string | undefined, stored: Pick<StoredProvider, 'provider' | 'model' | 'revision'>): Promise<AiProviderSetting['delivery']> {
  if (!path) return 'unconfigured'
  try {
    const written = JSON.parse(await readFile(path, 'utf8')) as { provider?: unknown; model?: unknown; revision?: unknown }
    return written.revision === stored.revision && written.provider === stored.provider && written.model === stored.model ? 'delivered' : 'pending'
  } catch { return 'pending' }
}

/** The vendor's view of the row: what is chosen, the last four characters of the key and whether the service has it. */
export async function settingOf(stored: StoredProvider, path: string | undefined): Promise<AiProviderSetting> {
  return {
    preset: stored.preset, provider: stored.provider, model: stored.model, base_url: stored.baseUrl, stream_usage: stored.streamUsage,
    key: { configured: stored.sealed !== null, last4: stored.last4 }, revision: stored.revision,
    updated_at: stored.updatedAt.toISOString(), updated_by: stored.updatedBy, delivery: await deliveryOf(path, stored),
  }
}
