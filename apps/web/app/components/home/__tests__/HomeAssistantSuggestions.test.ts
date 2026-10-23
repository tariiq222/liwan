import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@webvue/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../HomeAssistantSuggestions.vue')
const NuxtLink = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' } }, setup: (props, { attrs, slots }) => () => Vue.h('a', { ...attrs, href: props.to }, slots.default?.()) })
const UButton = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' }, label: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('a', { ...attrs, href: props.to }, props.label) })
const messages = { 'ai.home.title': 'اقتراحات المساعد اليوم', 'ai.home.source': 'مقترح من عملك', 'ai.home.ask': 'اسأل المساعد', 'ai.suggestionLabel': 'اقتراح' }

interface Row { id: string; label: string; to: string; tone: 'urgent' | 'normal'; caption?: string; suggestion?: string; module: string }
const row = (id: string, extra: Partial<Row> = {}): Row => ({ id, label: `بند ${id}`, to: `/${id}`, tone: 'normal', module: 'tasks', ...extra })

async function render({ rows = [] as Row[], surface = true, allowed = true } = {}) {
  const useAttention = vi.fn(() => ({ rows: Vue.computed(() => rows) }))
  const html = await renderShared(file, {}, {}, {
    messages, stubs: { ...DEFAULT_STUBS, NuxtLink, UButton },
    globals: { useMe: () => ({ me: Vue.ref({}) }) },
    modules: {
      '@/composables/useAttention': { useAttention },
      '@/modules/surfaces': { assistantSurface: () => (surface ? { capability: 'ai.use', labelKey: 'nav.ai', to: '/ai', load: async () => ({}) } : undefined) },
      '@/utils/accessPolicy': { canReach: () => allowed },
    },
  })
  return { html, useAttention }
}

describe('HomeAssistantSuggestions', () => {
  it('shows up to the rows it gets, each linking to its record, labelled as suggested from the user\'s own work', async () => {
    const { html } = await render({ rows: [row('a', { caption: 'غدًا', suggestion: 'ابدأ بها' }), row('b')] })
    expect(html).toContain('اقتراحات المساعد اليوم')
    expect(html).toContain('مقترح من عملك')
    expect(html.match(/data-testid="home-assistant-row"/g)).toHaveLength(2)
    expect(html).toContain('href="/a"')
    expect(html).toContain('غدًا')
    expect(html).toContain('ابدأ بها')
    expect(html).not.toMatch(/AI-generated|مولّد|نموذج/)
  })

  it('has the ask-the-assistant button to the assistant surface', async () => {
    const { html } = await render({ rows: [row('a')] })
    expect(html).toMatch(/href="\/ai"[^>]*>اسأل المساعد</)
  })

  it('is never an empty card', async () => {
    expect((await render({ rows: [] })).html).not.toContain('home-assistant-suggestions')
  })

  it('is absent when the assistant surface does not exist or the user may not use it', async () => {
    expect((await render({ rows: [row('a')], surface: false })).html).not.toContain('home-assistant-suggestions')
    expect((await render({ rows: [row('a')], allowed: false })).html).not.toContain('home-assistant-suggestions')
  })

  it('asks every application for three rows, but none when there is no surface for the user', async () => {
    const asked = await render({ rows: [row('a')] })
    const [scope, options] = asked.useAttention.mock.calls[0] as unknown as [() => string | null, { limit: number }]
    expect(scope()).toBe('all')
    expect(options).toEqual({ limit: 3 })
    const none = await render({ rows: [row('a')], allowed: false })
    expect((none.useAttention.mock.calls[0] as unknown as [() => string | null])[0]()).toBeNull()
  })
})
