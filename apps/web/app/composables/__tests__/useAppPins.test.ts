import { createApp, effectScope, nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withManifests } from '../../modules/manifests'
import type { AppManifest } from '../../modules/types'
import { effectivePins, movedPins, parseStoredPins, toggledPins, useAppPins } from '../useAppPins'

describe('pin helpers', () => {
  it('parses a stored list and ignores garbage', () => {
    expect(parseStoredPins('["a","b","a"]')).toEqual(['a', 'b'])
    expect(parseStoredPins('["a",1,null]')).toEqual(['a'])
    for (const raw of [null, '', '{', '"a"', '{"a":1}', '42']) expect(parseStoredPins(raw)).toBeNull()
  })

  it('shows every reachable application until the user chooses', () => {
    expect(effectivePins(null, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('filters a stored list to what is still reachable and does not pin applications added later', () => {
    expect(effectivePins(['c', 'gone', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a'])
    expect(effectivePins([], ['a', 'b'])).toEqual([])
  })

  it('toggles a pin: removes a pinned one, appends an unpinned one', () => {
    expect(toggledPins(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggledPins(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
  })

  it('moves a pin by a delta and stops at the ends', () => {
    expect(movedPins(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(movedPins(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c'])
    expect(movedPins(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(movedPins(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
    expect(movedPins(['a', 'b'], 'zzz', 1)).toEqual(['a', 'b'])
  })

  it('moves relative to the pins on show, stepping over hidden ones', () => {
    expect(movedPins(['a', 'b', 'c', 'd'], 'd', -1, ['a', 'c', 'd'])).toEqual(['a', 'b', 'd', 'c'])
    expect(movedPins(['a', 'b', 'c', 'd'], 'a', 1, ['a', 'c', 'd'])).toEqual(['b', 'c', 'a', 'd'])
    expect(movedPins(['a', 'b', 'c'], 'a', -1, ['a', 'c'])).toEqual(['a', 'b', 'c'])
  })
})

const app = (id: string, order: number): AppManifest =>
  ({ id, feature: `${id}.enabled`, routePrefixes: [`/${id}`], rail: [{ id, labelKey: id, icon: 'i-lucide-circle', to: `/${id}`, order }], nav: [{ to: `/${id}`, labelKey: id, icon: 'i-lucide-circle', shortcut: '', capability: `${id}.read` }] })
const manifests = [app('tasks', 10), app('chat', 20), app('hr', 30)]
const identity = (id: number) => ({ id, capabilities: ['tasks.read', 'chat.read', 'hr.read'], platform: { state: 'active', read_only: false, readable_features: ['tasks.enabled', 'chat.enabled', 'hr.enabled'], writable_features: ['tasks.enabled', 'chat.enabled', 'hr.enabled'] } })

class MemoryStorage {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
  removeItem(key: string) { this.data.delete(key) }
}

describe('useAppPins', () => {
  let storage: MemoryStorage
  let hydrated: Ref<boolean>
  let me: Ref<ReturnType<typeof identity> | null>
  const states = new Map<string, Ref<unknown>>()

  beforeEach(() => {
    storage = new MemoryStorage()
    hydrated = ref(false)
    me = ref(identity(7))
    states.clear()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
    vi.stubGlobal('useMe', () => ({ me }))
    vi.stubGlobal('useHydrated', () => hydrated)
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!states.has(key)) states.set(key, ref(init()))
      return states.get(key)!
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  function mount() {
    const host = createApp({ render: () => null })
    return host.runWithContext(() => effectScope().run(() => useAppPins())!)
  }
  // The reachable applications are derived lazily, so the manifests stay installed for the whole test body.
  const scenario = (body: () => void | Promise<void>) => () => withManifests(manifests, async () => { await body() })

  it('shows every reachable application by default, in manifest order, and reads nothing before hydration', scenario(async () => {
    storage.setItem('webvue.pins.v1:7', '["hr"]')
    const pins = mount()
    expect(pins.pinned.value).toEqual(['tasks', 'chat', 'hr'])
    hydrated.value = true
    await nextTick()
    expect(pins.pinned.value).toEqual(['hr'])
  }))

  it('keeps one choice per user id', scenario(async () => {
    storage.setItem('webvue.pins.v1:7', '["chat"]')
    storage.setItem('webvue.pins.v1:8', '["hr"]')
    hydrated.value = true
    const pins = mount()
    expect(pins.pinned.value).toEqual(['chat'])
    me.value = identity(8)
    await nextTick()
    expect(pins.pinned.value).toEqual(['hr'])
  }))

  it('toggles and saves the choice for the user', scenario(async () => {
    hydrated.value = true
    const pins = mount()
    pins.toggle('chat')
    expect(pins.pinned.value).toEqual(['tasks', 'hr'])
    expect(JSON.parse(storage.getItem('webvue.pins.v1:7')!)).toEqual(['tasks', 'hr'])
    pins.toggle('chat')
    expect(pins.pinned.value).toEqual(['tasks', 'hr', 'chat'])
  }))

  it('moves a pin and saves the new order', scenario(async () => {
    hydrated.value = true
    const pins = mount()
    pins.move('hr', -2)
    expect(pins.pinned.value).toEqual(['hr', 'tasks', 'chat'])
    expect(JSON.parse(storage.getItem('webvue.pins.v1:7')!)).toEqual(['hr', 'tasks', 'chat'])
  }))

  it('does not pin an application added after the user chose, and hides one that is not reachable', scenario(async () => {
    storage.setItem('webvue.pins.v1:7', '["tasks","gone"]')
    hydrated.value = true
    expect(mount().pinned.value).toEqual(['tasks'])
  }))

  it('keeps the stored pin of an unreachable application when saving', scenario(async () => {
    storage.setItem('webvue.pins.v1:7', '["tasks","gone","chat"]')
    hydrated.value = true
    const pins = mount()
    pins.toggle('hr')
    expect(JSON.parse(storage.getItem('webvue.pins.v1:7')!)).toEqual(['tasks', 'gone', 'chat', 'hr'])
    pins.move('chat', -1)
    expect(JSON.parse(storage.getItem('webvue.pins.v1:7')!)).toEqual(['chat', 'tasks', 'gone', 'hr'])
    pins.toggle('tasks')
    expect(JSON.parse(storage.getItem('webvue.pins.v1:7')!)).toEqual(['chat', 'gone', 'hr'])
  }))

  it('moves relative to the pins on show when given them', scenario(async () => {
    hydrated.value = true
    const pins = mount()
    pins.move('hr', -1, ['tasks', 'hr'])
    expect(pins.pinned.value).toEqual(['hr', 'tasks', 'chat'])
  }))

  it('picks up a change made in another tab and stops listening with its scope', scenario(async () => {
    const listeners = new Map<string, (event: unknown) => void>()
    vi.stubGlobal('window', { addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn), removeEventListener: (type: string) => listeners.delete(type) })
    hydrated.value = true
    const host = createApp({ render: () => null })
    const scope = effectScope()
    const pins = host.runWithContext(() => scope.run(() => useAppPins())!)
    expect(pins.pinned.value).toEqual(['tasks', 'chat', 'hr'])
    storage.setItem('webvue.pins.v1:7', '["hr"]')
    listeners.get('storage')!({ key: 'webvue.pins.v1:8' })
    expect(pins.pinned.value).toEqual(['tasks', 'chat', 'hr'])
    listeners.get('storage')!({ key: 'webvue.pins.v1:7' })
    expect(pins.pinned.value).toEqual(['hr'])
    scope.stop()
    expect(listeners.has('storage')).toBe(false)
  }))

  it('survives unusable storage', scenario(async () => {
    hydrated.value = true
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } })
    const pins = mount()
    expect(pins.pinned.value).toEqual(['tasks', 'chat', 'hr'])
    pins.toggle('chat')
    expect(pins.pinned.value).toEqual(['tasks', 'hr'])
  }))

  it('shows nothing while the identity is unknown', scenario(async () => {
    me.value = null
    hydrated.value = true
    expect(mount().pinned.value).toEqual([])
  }))
})
