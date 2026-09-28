import { open, rename, unlink, lstat } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(dirname(path), 'r')
  try { await directory.sync() } finally { await directory.close() }
}
/** Single shared local filesystem only. Never reclaim by TTL/PID: a paused
 * publisher may still resume. Crash leftovers require offline operator repair
 * after stopping all publishers, preserving any pending barrier. */
export async function withPublicationLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  if (!isAbsolute(path)) throw new Error('registry_path_invalid')
  const lockPath = `${path}.publisher-lock`
  const lock = await open(lockPath, 'wx', 0o600).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') throw new Error('registry_lock_unavailable', { cause: error })
    throw error
  })
  try {
    await lock.writeFile(JSON.stringify({ owner: randomUUID(), pid: process.pid }))
    await lock.sync()
    await syncDirectory(path)
    return await action()
  } finally {
    await lock.close()
    await unlink(lockPath)
    await syncDirectory(path)
  }
}
/** Low-level primitive: caller must hold withPublicationLock for this same path
 * across SQL mutation and completion. Exported for focused fault tests only. */
export async function beginPublication(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error('registry_path_invalid')
  const marker = await open(`${path}.pending`, 'wx', 0o600)
  try { await marker.writeFile('registry publication pending\n'); await marker.sync() }
  finally { await marker.close() }
  await syncDirectory(path)
}
/** Caller holds both withPublicationLock and registry session lock; authority already committed. Errors
 * deliberately leave the pending marker and any temp evidence, never restore old data. */
export async function completePublication(path: string, snapshot: unknown): Promise<void> {
  const marker = await lstat(`${path}.pending`)
  if (!marker.isFile() || marker.isSymbolicLink()) throw new Error('registry_marker_invalid')
  const bytes = JSON.stringify(snapshot)
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
  await rename(temporary, path)
  await syncDirectory(path)
  await unlink(`${path}.pending`)
  await syncDirectory(path)
}
