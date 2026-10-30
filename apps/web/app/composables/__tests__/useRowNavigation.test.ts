import * as Vue from 'vue'
import { defineComponent, h, nextTick, ref, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHostNode, hostRenderer, type HostNode } from '@liwan/ui/test/helpers/hostRenderer'
import { useHydrated } from '@liwan/ui/app/composables/useHydrated'
import { useRowNavigation } from '@liwan/ui/app/composables/useRowNavigation'
import { useShellShortcuts } from '../useShellShortcuts'

// The composables reach for Nuxt auto-imports; the real ones are wired here (as useEscapeBack.test.ts does).
const globals = globalThis as Record<string, unknown>
globals.ref = Vue.ref
globals.onMounted = Vue.onMounted
globals.useHydrated = useHydrated
// usePalette keeps its state in Nuxt's useState; one plain ref per key stands in for it.
const states = new Map<string, Vue.Ref<unknown>>()
globals.useState = (key: string, init: () => unknown) => {
  if (!states.has(key)) states.set(key, ref(init()))
  return states.get(key)
}

type Listener = (event: unknown) => void
function eventTarget() {
  const listeners = new Set<Listener>()
  return {
    listeners,
    addEventListener(type: string, listener: Listener) { if (type === 'keydown') listeners.add(listener) },
    removeEventListener(type: string, listener: Listener) { if (type === 'keydown') listeners.delete(listener) },
  }
}
let win: ReturnType<typeof eventTarget>
let doc: ReturnType<typeof eventTarget> & { activeElement: unknown; overlayOpen: boolean; querySelector: (selectors: string) => unknown }

interface FakeKey {
  key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean
  repeat: boolean; isComposing: boolean; keyCode: number; timeStamp: number; target: unknown
  defaultPrevented: boolean; preventDefault: () => void
}
function key(name: string, code: string, timeStamp = 0, patch: Partial<FakeKey> = {}): FakeKey {
  const event: FakeKey = {
    key: name, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false,
    keyCode: 0, timeStamp, target: { tagName: 'BODY', closest: () => null }, defaultPrevented: false,
    preventDefault() { event.defaultPrevented = true },
    ...patch,
  }
  return event
}
/** A keydown as the browser delivers it: the shell's window capture listener first, then the document. */
function press(event: FakeKey) {
  for (const listener of [...win.listeners]) listener(event)
  for (const listener of [...doc.listeners]) listener(event)
  return event
}

function makeRow(name: string, patch: { visible?: boolean; inert?: boolean } = {}) {
  const row = {
    name,
    visible: patch.visible ?? true,
    inert: patch.inert ?? false,
    link: { click: vi.fn() },
    focus: vi.fn(() => { doc.activeElement = row }),
    scrollIntoView: vi.fn(),
    getClientRects: () => ({ length: row.visible ? 1 : 0 }),
    closest: (selectors: string) => (row.inert && selectors.includes('[inert]') ? {} : null),
    contains: (node: unknown) => node === row,
    querySelector: (selectors: string) => (selectors === 'a[href]' ? row.link : null),
  }
  return row
}
type FakeRow = ReturnType<typeof makeRow>

const apps: App<HostNode>[] = []
async function mount(rows: FakeRow[], options: { shell?: boolean } = {}) {
  const container = ref({ querySelectorAll: () => rows } as unknown as HTMLElement)
  const app = hostRenderer.createApp(defineComponent({
    setup() {
      // ShellHeader's handlers: the go handler always uses the key, even when no item has that letter.
      if (options.shell) useShellShortcuts({ go: () => true })
      useRowNavigation(container)
      return () => h('div')
    },
  }))
  app.mount(createHostNode())
  apps.push(app)
  await nextTick()
}

beforeEach(() => {
  states.clear()
  win = eventTarget()
  doc = Object.assign(eventTarget(), {
    activeElement: { tagName: 'BODY' } as unknown,
    overlayOpen: false,
    querySelector(selectors: string) { return doc.overlayOpen && selectors.includes('data-dismissable-layer') ? {} : null },
  })
  globals.window = win
  globals.document = doc
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  delete globals.window
  delete globals.document
})

describe('useRowNavigation', () => {
  it('J and K move focus and clamp at both ends of the list', async () => {
    const [a, b, c] = [makeRow('a'), makeRow('b'), makeRow('c')]
    await mount([a!, b!, c!])
    press(key('j', 'KeyJ'))
    expect(doc.activeElement).toBe(a)
    press(key('j', 'KeyJ'))
    press(key('j', 'KeyJ'))
    expect(doc.activeElement).toBe(c)
    const atEnd = press(key('j', 'KeyJ'))
    expect(doc.activeElement, 'J on the last row stays on it').toBe(c)
    expect(atEnd.defaultPrevented).toBe(true)
    press(key('k', 'KeyK'))
    press(key('k', 'KeyK'))
    press(key('k', 'KeyK'))
    expect(doc.activeElement, 'K on the first row stays on it').toBe(a)
  })

  it('J skips rows the user cannot see or reach', async () => {
    const hidden = makeRow('desktop row on a phone', { visible: false })
    const inert = makeRow('inert', { inert: true })
    const [a, b] = [makeRow('a'), makeRow('b')]
    await mount([hidden, a!, inert, b!])
    press(key('j', 'KeyJ'))
    expect(doc.activeElement).toBe(a)
    press(key('j', 'KeyJ'))
    expect(doc.activeElement).toBe(b)
    expect(hidden.focus).not.toHaveBeenCalled()
    expect(inert.focus).not.toHaveBeenCalled()
  })

  it('G then J does not move: the shell takes the J and the rows skip it', async () => {
    const a = makeRow('a')
    await mount([a, makeRow('b')], { shell: true })
    press(key('g', 'KeyG', 0))
    const j = press(key('j', 'KeyJ', 200))
    expect(j.defaultPrevented, 'the shell used the letter after G').toBe(true)
    expect(a.focus).not.toHaveBeenCalled()
    // Once the chord is over, J moves again.
    press(key('j', 'KeyJ', 5000))
    expect(doc.activeElement).toBe(a)
  })

  it('an open menu or dialog blocks J and K', async () => {
    const a = makeRow('a')
    await mount([a])
    doc.overlayOpen = true
    const j = press(key('j', 'KeyJ'))
    expect(a.focus).not.toHaveBeenCalled()
    expect(j.defaultPrevented).toBe(false)
  })

  it('Enter on a focused row opens its link, but not with a modifier', async () => {
    const a = makeRow('a')
    await mount([a])
    press(key('j', 'KeyJ'))
    press(key('Enter', 'Enter', 0, { metaKey: true }))
    expect(a.link.click).not.toHaveBeenCalled()
    press(key('Enter', 'Enter'))
    expect(a.link.click).toHaveBeenCalledTimes(1)
  })
})
