import { resolve } from 'node:path'
import * as Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadShared } from '@liwan/ui/test/helpers/renderShared'
import { createHostNode, findNodes, hostRenderer, type HostNode } from '@liwan/ui/test/helpers/hostRenderer'
import { workCountLabel } from '../../../composables/nav/attentionModel'

const file = resolve(import.meta.dirname, '../HomeGreeting.vue')
const Hello = Vue.defineComponent({ props: { title: { type: String, default: '' } }, setup: (props, { slots }) => () => Vue.h('header', [Vue.h('h1', props.title), slots.default ? Vue.h('p', slots.default()) : null]) })
const messages: Record<string, string> = {
  'nav.home': 'يومي', 'home.greeting': 'أهلًا {name}', 'home.greetingMorning': 'صباح الخير يا {name}', 'home.greetingEvening': 'مساء الخير يا {name}',
  'home.count.tasks': '{n} مهام', 'home.count.decisions': '{n} قرارات',
  'home.summary.one': 'عندك {item} تنتظرك اليوم', 'home.summary.two': 'عندك {first} و{second} تنتظرك اليوم',
}
const t = (key: string, params: Record<string, unknown> = {}) => (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))

interface Setup { name?: string; hour?: number; available?: boolean; pending?: boolean; failed?: boolean; execute?: number; decide?: number; capped?: string[]; mounted?: boolean }

function text(node: HostNode): string {
  return (node.text ?? '') + node.children.map(text).join('')
}

async function mount({ name = 'سارة العتيبي', hour = 9, available = true, pending = false, failed = false, execute = 0, decide = 0, capped = [] as string[] }: Setup = {}) {
  vi.setSystemTime(new Date(2026, 10, 8, hour, 0))
  const grouped = { execute: Array.from({ length: execute }, (_, i) => ({ id: `e${i}` })), decide: Array.from({ length: decide }, (_, i) => ({ id: `d${i}` })), follow: [] }
  const Greeting = loadShared(file, {
    globals: {
      useI18n: () => ({ t, locale: Vue.ref('ar') }),
      useMe: () => ({ me: Vue.ref({ name }) }),
      ref: Vue.ref, computed: Vue.computed, onMounted: Vue.onMounted,
    },
    modules: {
      '@/composables/nav/attentionModel': { workCountLabel },
      '@/composables/useMyWork': { useMyWork: () => ({ available: Vue.ref(available), grouped: Vue.ref(grouped), pending: Vue.ref(pending), failed: Vue.ref(failed), cappedKinds: Vue.ref(capped) }) },
      '@/components/home/HomeHello.vue': { __esModule: true, default: Hello },
    },
  })
  const app = hostRenderer.createApp(Greeting)
  const host = createHostNode()
  const lines = () => ({ title: text(findNodes(host, node => node.type === 'h1')[0]!), subtitle: findNodes(host, node => node.type === 'p').map(text)[0] ?? '' })
  app.mount(host)
  const beforeMount = lines()
  await Vue.nextTick()
  return { lines, beforeMount, unmount: () => app.unmount() }
}

afterEach(() => { vi.useRealTimers() })

describe('HomeGreeting', () => {
  it('greets by first name in the morning, with the date and what waits today', async () => {
    vi.useFakeTimers()
    const view = await mount({ execute: 7, decide: 2 })
    expect(view.lines().title).toBe('صباح الخير يا سارة')
    expect(view.lines().subtitle).toContain('2026')
    expect(view.lines().subtitle).toContain('عندك 7 مهام و2 قرارات تنتظرك اليوم')
    view.unmount()
  })

  it('greets in the evening from noon on', async () => {
    vi.useFakeTimers()
    const view = await mount({ hour: 12 })
    expect(view.lines().title).toBe('مساء الخير يا سارة')
    view.unmount()
  })

  it('names only the kind that has something, and marks a capped count as a lower bound', async () => {
    vi.useFakeTimers()
    const tasksOnly = await mount({ execute: 3 })
    expect(tasksOnly.lines().subtitle).toContain('عندك 3 مهام تنتظرك اليوم')
    expect(tasksOnly.lines().subtitle).not.toContain('قرارات')
    tasksOnly.unmount()
    const capped = await mount({ decide: 20, capped: ['decide'] })
    expect(capped.lines().subtitle).toContain('عندك 20+ قرارات تنتظرك اليوم')
    capped.unmount()
  })

  it('says nothing about work that is pending, failed, absent or empty, never a zero', async () => {
    vi.useFakeTimers()
    for (const setup of [{ pending: true, execute: 1 }, { failed: true, execute: 1 }, { available: false, execute: 1 }, {}]) {
      const view = await mount(setup)
      expect(view.lines().subtitle).not.toContain('عندك')
      expect(view.lines().subtitle).toContain('2026')
      view.unmount()
    }
  })

  it('draws the first frame with the name alone, as the server does, before the browser time is read', async () => {
    vi.useFakeTimers()
    const view = await mount({ hour: 20 })
    expect(view.beforeMount.title).toBe('أهلًا سارة')
    expect(view.beforeMount.subtitle).toBe('')
    view.unmount()
  })

  it('falls back to the page name when the person has no name', async () => {
    vi.useFakeTimers()
    const view = await mount({ name: '  ' })
    expect(view.lines().title).toBe('يومي')
    view.unmount()
  })
})
