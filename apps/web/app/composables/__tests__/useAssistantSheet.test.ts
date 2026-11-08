import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { withManifests } from '../../modules/manifests'
import type { AppManifest } from '../../modules/types'
import { assistantContext, isSurfacePath, useAssistantSheet } from '../useAssistantSheet'

const surface = { capability: 'ai.use', labelKey: 'ai.sheet.label', to: '/ai', load: async () => ({ default: {} }) }
const assistantManifest = { id: 'ai', feature: 'ai.enabled', routePrefixes: ['/ai'], rail: [], nav: [], assistant: surface } as unknown as AppManifest
const projects = { id: 'pmo', feature: 'pmo.enabled', routePrefixes: ['/projects'], rail: [], nav: [], routeScopes: [{ kind: 'project', idFromPath: (path: string) => /^\/projects\/(\d+)/.exec(path)?.[1] ? Number(/^\/projects\/(\d+)/.exec(path)![1]) : null }] } as unknown as AppManifest
const entitled = { capabilities: ['ai.use'], platform: { readable_features: ['ai.enabled'], writable_features: ['ai.enabled'] } }

describe('isSurfacePath', () => {
  it.each(['/ai', '/ai/', '/ai/history'])('%s is the assistant page', path => expect(isSurfacePath(path, '/ai')).toBe(true))
  it.each(['/', '/aiding', '/projects/ai'])('%s is not', path => expect(isSurfacePath(path, '/ai')).toBe(false))
})

describe('assistantContext', () => {
  it('names the record the path lives inside, else the rail module', () => {
    withManifests([projects], () => {
      expect(assistantContext('/projects/12/tasks', 'projects')).toBe('project:12')
      expect(assistantContext('/hr', 'hr')).toBe('hr')
    })
  })
  it.each(['home', 'settings'])('says nothing on the foundation module %s', (id) => {
    expect(assistantContext('/x', id)).toBeNull()
  })
  it('says nothing for a module id the page would not accept', () => {
    expect(assistantContext('/x', null)).toBeNull()
    expect(assistantContext('/x', 'Not-A-Page')).toBeNull()
  })
})

describe('useAssistantSheet', () => {
  const state = new Map<string, ReturnType<typeof ref>>()
  let route: { path: string }
  let me: ReturnType<typeof ref>

  function setup(manifests: AppManifest[] = [assistantManifest]) {
    const scope = effectScope()
    return scope.run(() => withManifests(manifests, () => useAssistantSheet()))!
  }
  const element = () => ({ focus: vi.fn(), isConnected: true }) as unknown as HTMLElement
  // The gate reads the manifests lazily, so every read happens inside the override.
  const read = <T>(manifests: AppManifest[], fn: () => T) => withManifests(manifests, fn)

  beforeEach(() => {
    state.clear()
    route = reactive({ path: '/projects' })
    me = ref(entitled)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useMe', () => ({ me }))
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!state.has(key)) state.set(key, ref(init()))
      return state.get(key)
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders nothing without a declared surface', () => {
    const sheet = setup([projects])
    expect(read([projects], () => sheet.surface.value)).toBeUndefined()
    expect(read([projects], () => sheet.showButton.value)).toBe(false)
  })

  it('renders nothing without the capability, or without the application feature', () => {
    const sheet = setup()
    me.value = { capabilities: [], platform: entitled.platform }
    expect(read([assistantManifest], () => sheet.showButton.value)).toBe(false)
    me.value = { capabilities: ['ai.use'], platform: { readable_features: [], writable_features: [] } }
    expect(read([assistantManifest], () => sheet.showButton.value)).toBe(false)
    me.value = entitled
    expect(read([assistantManifest], () => sheet.showButton.value)).toBe(true)
  })

  it('opens and closes through the one slide-over state, and shows only for its own panel', () => {
    const sheet = setup()
    read([assistantManifest], () => {
      sheet.toggle(element())
      expect(sheet.shown.value).toBe(true)
      expect(state.get('slide-over')!.value).toBe('assistant')
      sheet.close()
      expect(sheet.shown.value).toBe(false)
    })
    state.get('slide-over')!.value = 'notifications'
    read([assistantManifest], () => {
      expect(sheet.shown.value).toBe(false)
      sheet.close()
    })
    expect(state.get('slide-over')!.value).toBe('notifications')
  })

  it('returns focus to the opener on close, and not when asked not to', async () => {
    const sheet = setup()
    const opener = element()
    read([assistantManifest], () => { sheet.toggle(opener); sheet.close() })
    await nextTick()
    expect(opener.focus).toHaveBeenCalledOnce()
    const other = element()
    read([assistantManifest], () => { sheet.toggle(other); sheet.close({ restoreFocus: false }) })
    await nextTick()
    expect(other.focus).not.toHaveBeenCalled()
  })

  it('hides the panel on the assistant page without losing the button rule', () => {
    const sheet = setup()
    read([assistantManifest], () => { sheet.toggle(element()); route.path = '/ai' })
    expect(read([assistantManifest], () => sheet.onSurfacePage.value)).toBe(true)
    expect(read([assistantManifest], () => sheet.shown.value)).toBe(false)
    expect(read([assistantManifest], () => sheet.showButton.value)).toBe(false)
  })

  it('links to the full page carrying the current record as context', () => {
    const sheet = setup()
    route.path = '/projects/12/tasks'
    expect(read([assistantManifest, projects], () => sheet.fullPageTo('projects'))).toEqual({ path: '/ai', query: { context: 'project:12' } })
    route.path = '/hr'
    expect(read([assistantManifest, projects], () => sheet.fullPageTo(null))).toEqual({ path: '/ai' })
  })
})
