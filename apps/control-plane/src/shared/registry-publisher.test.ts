import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as fs from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { withPublicationLock, beginPublication, completePublication } from './registry-publisher.js'

// Preserve real filesystem effects but expose a configurable pause point.
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

it('excludes recovery until a paused publisher relinquishes the filesystem lock', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'webvue-publish-lock-')), 'registry.json')
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const paused = new Promise<void>(resolve => { release = resolve })
  const first = withPublicationLock(path, async () => { entered(); await paused })
  await started
  try { await expect(withPublicationLock(path, async () => { throw Error('must_not_enter') })).rejects.toThrow('registry_lock_unavailable') }
  finally { release(); await first }
  await expect(withPublicationLock(path, async () => 'next')).resolves.toBe('next')
})
it('does not steal a leftover filesystem lock based on age', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'webvue-publish-lock-')), 'registry.json')
  await writeFile(`${path}.publisher-lock`, 'crashed publisher evidence')
  await expect(withPublicationLock(path, async () => 'unsafe')).rejects.toThrow('registry_lock_unavailable')
  expect(await readFile(`${path}.publisher-lock`, 'utf8')).toBe('crashed publisher evidence')
})
it('keeps lock and pending barrier after a real publisher process crash', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'webvue-publish-crash-')), 'registry.json')
  const moduleUrl = new URL('./registry-publisher.ts', import.meta.url).href
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { withPublicationLock, beginPublication } from ${JSON.stringify(moduleUrl)};
    await withPublicationLock(process.argv[1], async () => {
      await beginPublication(process.argv[1]); process.send('ready');
      setInterval(() => {}, 1000); await new Promise(() => {});
    });
  `, path], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''; child.stderr!.on('data', bytes => { stderr += bytes })
  const exited = once(child, 'exit')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      once(child, 'message'),
      exited.then(() => { throw Error('publisher_exited:' + stderr) }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('publisher_start_timeout')), 5000) }),
    ])
    // The parent is a separate OS process competing with the live child.
    await expect(withPublicationLock(path, async () => 'must_not_enter')).rejects.toThrow('registry_lock_unavailable')
    await access(`${path}.pending`)
    child.kill('SIGKILL'); await exited
    await access(`${path}.publisher-lock`); await access(`${path}.pending`)
    await expect(withPublicationLock(path, async () => 'unsafe')).rejects.toThrow('registry_lock_unavailable')
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  }
}, 10000)
it('releases live-process ownership after publication fails without removing the pending barrier', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'webvue-publish-failure-')), 'registry.json')
  await expect(withPublicationLock(path, async () => {
    await beginPublication(path)
    await completePublication(path, { invalid: 1n })
  })).rejects.toThrow()
  await access(`${path}.pending`)
  await expect(access(`${path}.publisher-lock`)).rejects.toThrow()
  await withPublicationLock(path, () => completePublication(path, { revision: 1 }))
  expect(JSON.parse(await readFile(path,'utf8'))).toEqual({ revision: 1 })
})
it('excludes a competing publisher after rename but before clearing the barrier', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'webvue-publish-rename-')), 'registry.json')
  let release!: () => void, renamed!: () => void
  const reached = new Promise<void>(resolve => { renamed = resolve })
  const paused = new Promise<void>(resolve => { release = resolve })
  const original = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename
  const spy = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
    await original(source, target)
    if (target === path) { renamed(); await paused }
  })
  const active = withPublicationLock(path, async () => {
    await beginPublication(path)
    await completePublication(path, { revision: 2 })
  })
  try {
    await Promise.race([reached, active.then(() => { throw Error('pause_not_reached') })])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ revision: 2 })
    await access(`${path}.pending`)
    await expect(withPublicationLock(path, async () => completePublication(path, { revision: 1 }))).rejects.toThrow('registry_lock_unavailable')
    await access(`${path}.pending`)
  } finally { release(); await active; spy.mockRestore() }
  await expect(access(`${path}.pending`)).rejects.toThrow()
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ revision: 2 })
})
it('persists a barrier before replacing the snapshot and clears it only after publication', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'webvue-publish-')), 'registry.json')
  await writeFile(path, 'old')
  await beginPublication(path)
  expect(await readFile(path, 'utf8')).toBe('old')
  await access(`${path}.pending`)
  await completePublication(path, { revision: 2 })
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ revision: 2 })
  await expect(access(`${path}.pending`)).rejects.toThrow()
})
it('retains the barrier on snapshot serialization failure', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'webvue-publish-')), 'registry.json')
  await writeFile(path, 'old')
  await beginPublication(path)
  await expect(completePublication(path, { revision: 2n })).rejects.toThrow()
  await access(`${path}.pending`)
  expect(await readFile(path, 'utf8')).toBe('old')
})
it('refuses a second mutation while previous publication is unresolved', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'webvue-publish-')), 'registry.json')
  await beginPublication(path)
  await expect(beginPublication(path)).rejects.toThrow()
  await access(`${path}.pending`)
})
