import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { withManifests } from '../../modules/manifests'
import type { AppManifest } from '../../modules/types'
import {
  assistantContext, assistantEscapeCloses, assistantSheetMode, holdPageBehind, isSurfacePath, SESSION_KEY, useAssistantSheet,
} from '../useAssistantSheet'

const surface = { capability: 'ai.use', labelKey: 'ai.sheet.label', to: '/ai', load: async () => ({ default: {} }) }
const assistantManifest = { id: 'ai', feature: 'ai.enabled', routePrefixes: ['/ai'], rail: [], nav: [], assistant: surface } as unknown as AppManifest
const projects = { id: 'pmo', feature: 'pmo.enabled', routePrefixes: ['/projects'], rail: [], nav: [], routeScopes: [{ kind: 'project', idFromPath: (path: string) => /^\/projects\/(\d+)/.exec(path)?.[1] ? Number(/^\/projects\/(\d+)/.exec(path)![1]) : null }] } as unknown as AppManifest
const entitled = { capabilities: ['ai.use'], platform: { readable_features: ['ai.enabled'], writable_features: ['ai.enabled'] } }

class FakeStorage {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

describe('assistantSheetMode', () => {
  it.each([[true, true, 'push'], [false, true, 'overlay'], [false, false, 'full']] as const)('wide=%s desktop=%s is %s', (wide, desktop, expected) => {
    expect(assistantSheetMode(wide, desktop)).toBe(expected)
  })
})

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

describe('holdPageBehind', () => {
  const fakeElement = (classes: string[] = [], inert = false) => {
    const attrs = new Map<string, string>(inert ? [['inert', '']] : [])
    return {
      classList: { contains: (name: string) => classes.includes(name) },
      hasAttribute: (name: string) => attrs.has(name),
      setAttribute: (name: string, value: string) => { attrs.set(name, value) },
      removeAttribute: (name: string) => { attrs.delete(name) },
      attrs,
    }
  }
  it('makes the siblings inert and locks the body scroll, then restores both', () => {
    const header = fakeElement()
    const workspace = fakeElement()
    const scrim = fakeElement(['liwan-assistant-scrim'])
    const alreadyInert = fakeElement([], true)
    const sheet = Object.assign(fakeElement(), { parentElement: null as unknown })
    const host = { children: [header, workspace, scrim, alreadyInert, sheet] }
    sheet.parentElement = host
    const body = { style: { overflow: 'auto' } }
    const release = holdPageBehind(sheet as unknown as Element, body as unknown as HTMLElement)
    expect(header.attrs.has('inert')).toBe(true)
    expect(workspace.attrs.has('inert')).toBe(true)
    expect(scrim.attrs.has('inert')).toBe(false)
    expect(sheet.attrs.has('inert')).toBe(false)
    expect(body.style.overflow).toBe('hidden')
    release()
    expect(header.attrs.has('inert')).toBe(false)
    expect(workspace.attrs.has('inert')).toBe(false)
    expect(alreadyInert.attrs.has('inert')).toBe(true)
    expect(body.style.overflow).toBe('auto')
  })
})

describe('assistantEscapeCloses', () => {
  const base = { shown: true, mode: 'push' as const, insideSheet: true, overlayOpen: false }
  it('closes on Escape from inside a pushed sheet', () => expect(assistantEscapeCloses({ key: 'Escape' }, base)).toBe(true))
  it('leaves Escape to the page while focus is outside a pushed sheet', () => expect(assistantEscapeCloses({ key: 'Escape' }, { ...base, insideSheet: false })).toBe(false))
  it.each(['overlay', 'full'] as const)('closes from anywhere in %s mode', mode => expect(assistantEscapeCloses({ key: 'Escape' }, { ...base, mode, insideSheet: false })).toBe(true))
  it('yields to a menu or dialog that owns the key', () => expect(assistantEscapeCloses({ key: 'Escape' }, { ...base, overlayOpen: true })).toBe(false))
  it('ignores other keys, modified keys, an IME and a closed sheet', () => {
    expect(assistantEscapeCloses({ key: 'Enter' }, base)).toBe(false)
    expect(assistantEscapeCloses({ key: 'Escape', shiftKey: true }, base)).toBe(false)
    expect(assistantEscapeCloses({ key: 'Escape', isComposing: true }, base)).toBe(false)
    expect(assistantEscapeCloses({ key: 'Escape' }, { ...base, shown: false })).toBe(false)
  })
})

describe('useAssistantSheet', () => {
  const state = new Map<string, ReturnType<typeof ref>>()
  let route: { path: string }
  let me: ReturnType<typeof ref>
  let storage: FakeStorage

  function setup(manifests: AppManifest[] = [assistantManifest]) {
    const scope = effectScope()
    const sheet = scope.run(() => withManifests(manifests, () => useAssistantSheet()))!
    return { sheet, scope, manifests }
  }
  const element = () => ({ focus: vi.fn(), isConnected: true }) as unknown as HTMLElement

  beforeEach(() => {
    state.clear()
    route = reactive({ path: '/projects' })
    me = ref(entitled)
    storage = new FakeStorage()
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useMe', () => ({ me }))
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!state.has(key)) state.set(key, ref(init()))
      return state.get(key)
    })
    vi.stubGlobal('window', { sessionStorage: storage })
  })
  afterEach(() => vi.unstubAllGlobals())

  // The gate reads the manifests lazily, so every read happens inside the override.
  const read = <T>(manifests: AppManifest[], fn: () => T) => withManifests(manifests, fn)

  it('renders nothing without a declared surface', () => {
    const { sheet } = setup([projects])
    expect(read([projects], () => sheet.surface.value)).toBeUndefined()
    expect(read([projects], () => sheet.showButton.value)).toBe(false)
  })

  it('renders nothing without the capability, or without the application feature', () => {
    const { sheet } = setup()
    me.value = { capabilities: [], platform: entitled.platform }
    expect(read([assistantManifest], () => sheet.showButton.value)).toBe(false)
    me.value = { capabilities: ['ai.use'], platform: { readable_features: [], writable_features: [] } }
    expect(read([assistantManifest], () => sheet.showButton.value)).toBe(false)
    me.value = entitled
    expect(read([assistantManifest], () => sheet.showButton.value)).toBe(true)
  })

  it('opens, closes and toggles, and refuses to open where the button is hidden', () => {
    const { sheet } = setup()
    read([assistantManifest], () => {
      sheet.openSheet(element())
      expect(sheet.shown.value).toBe(true)
      sheet.close()
      expect(sheet.shown.value).toBe(false)
      sheet.toggle(element())
      expect(sheet.shown.value).toBe(true)
      sheet.toggle()
      expect(sheet.shown.value).toBe(false)
      route.path = '/ai'
    })
    state.get('assistant-sheet-open')!.value = false
    read([assistantManifest], () => {
      sheet.openSheet(element())
      expect(sheet.shown.value).toBe(false)
    })
  })

  it('returns focus to the opener on close, and not when asked not to', async () => {
    const { sheet } = setup()
    const opener = element()
    read([assistantManifest], () => { sheet.openSheet(opener); sheet.close() })
    await nextTick()
    expect(opener.focus).toHaveBeenCalledOnce()
    const other = element()
    read([assistantManifest], () => { sheet.openSheet(other); sheet.close({ restoreFocus: false }) })
    await nextTick()
    expect(other.focus).not.toHaveBeenCalled()
  })

  it('does not focus an opener that left the page', async () => {
    const { sheet } = setup()
    const opener = { focus: vi.fn(), isConnected: false } as unknown as HTMLElement
    read([assistantManifest], () => { sheet.openSheet(opener); sheet.close() })
    await nextTick()
    expect(opener.focus).not.toHaveBeenCalled()
  })

  it('asks for focus once per explicit open, never for a restore', () => {
    const { sheet } = setup()
    read([assistantManifest], () => { sheet.openSheet(element()) })
    expect(sheet.takeFocusRequest()).toBe(true)
    expect(sheet.takeFocusRequest()).toBe(false)
    read([assistantManifest], () => { sheet.close(); storage.setItem(SESSION_KEY, 'open'); sheet.restoreSession(true) })
    expect(sheet.takeFocusRequest()).toBe(false)
    expect(sheet.shown.value).toBe(true)
  })

  it('hides the sheet on the assistant page without losing the button rule', () => {
    const { sheet } = setup()
    read([assistantManifest], () => { sheet.openSheet(element()); route.path = '/ai' })
    expect(read([assistantManifest], () => sheet.onSurfacePage.value)).toBe(true)
    expect(read([assistantManifest], () => sheet.shown.value)).toBe(false)
    expect(read([assistantManifest], () => sheet.showButton.value)).toBe(false)
  })

  it('remembers the state for the session and restores it only on a wide screen', () => {
    const { sheet } = setup()
    read([assistantManifest], () => { sheet.openSheet(element()) })
    expect(storage.getItem(SESSION_KEY)).toBe('open')
    read([assistantManifest], () => { sheet.close() })
    expect(storage.getItem(SESSION_KEY)).toBe('closed')

    storage.setItem(SESSION_KEY, 'open')
    read([assistantManifest], () => sheet.restoreSession(false))
    expect(sheet.shown.value).toBe(false)
    read([assistantManifest], () => sheet.restoreSession(true))
    expect(sheet.shown.value).toBe(true)
  })

  it('does not restore on the assistant page', () => {
    const { sheet } = setup()
    storage.setItem(SESSION_KEY, 'open')
    route.path = '/ai'
    read([assistantManifest], () => sheet.restoreSession(true))
    expect(state.get('assistant-sheet-open')!.value).toBe(false)
  })

  it('works when sessionStorage is missing or throws', () => {
    const { sheet } = setup()
    vi.stubGlobal('window', { get sessionStorage(): never { throw new Error('blocked') } })
    expect(() => read([assistantManifest], () => { sheet.openSheet(element()); sheet.close(); sheet.restoreSession(true) })).not.toThrow()
    vi.stubGlobal('window', undefined)
    expect(() => read([assistantManifest], () => { sheet.openSheet(element()); sheet.close() })).not.toThrow()
  })

  it('links to the full page carrying the current record as context', () => {
    const { sheet } = setup()
    route.path = '/projects/12/tasks'
    expect(read([assistantManifest, projects], () => sheet.fullPageTo('projects'))).toEqual({ path: '/ai', query: { context: 'project:12' } })
    route.path = '/hr'
    expect(read([assistantManifest, projects], () => sheet.fullPageTo(null))).toEqual({ path: '/ai' })
  })
})
