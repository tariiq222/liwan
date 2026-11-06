import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The directory sync after the rename is the one step the real filesystem will not fail on request, so the module's `open` is wrapped.
const failures = vi.hoisted(() => ({ directoryOpens: false, directory: '' }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: ((path: string, ...rest: unknown[]) => (failures.directoryOpens && String(path) === failures.directory ? Promise.reject(new Error('EIO')) : (actual.open as (...args: unknown[]) => unknown)(path, ...rest))) as typeof actual.open }
})
const state = failures
const { replaceProviderFile } = await import('../ai-provider/store.js')

describe('replacing the platform provider file', () => {
  let dir: string
  let path: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ai-provider-file-')); path = join(dir, 'platform-provider.json'); state.directory = dir; state.directoryOpens = false })
  afterEach(async () => { state.directoryOpens = false; await rm(dir, { recursive: true, force: true }) })

  it('replaces the content atomically in mode 640 and hands back a function that restores the previous content', async () => {
    await writeFile(path, 'old')
    const restore = await replaceProviderFile(path, 'new')
    expect(await readFile(path, 'utf8')).toBe('new')
    expect((await stat(path)).mode & 0o777).toBe(0o640)
    await restore()
    expect(await readFile(path, 'utf8')).toBe('old')
    expect(await readdir(dir)).toEqual(['platform-provider.json'])
  })

  it('removes the file on restore when there was none before', async () => {
    const restore = await replaceProviderFile(path, 'new')
    await restore()
    expect(await readdir(dir)).toEqual([])
  })

  it('puts the previous content back and rethrows when the directory sync after the rename fails', async () => {
    await writeFile(path, 'old')
    state.directoryOpens = true
    await expect(replaceProviderFile(path, 'new')).rejects.toThrow('EIO')
    state.directoryOpens = false
    expect(await readFile(path, 'utf8')).toBe('old')
    expect(await readdir(dir)).toEqual(['platform-provider.json'])
  })

  it('leaves no file behind when the first write fails after the rename', async () => {
    state.directoryOpens = true
    await expect(replaceProviderFile(path, 'new')).rejects.toThrow('EIO')
    state.directoryOpens = false
    expect(await readdir(dir)).toEqual([])
  })
})
