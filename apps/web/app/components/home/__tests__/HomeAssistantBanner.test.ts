import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../HomeAssistantBanner.vue')
const NuxtLink = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' } }, setup: (props, { attrs, slots }) => () => Vue.h('a', { ...attrs, href: props.to }, slots.default?.()) })
const UButton = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' }, label: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('a', { ...attrs, href: props.to }, props.label) })
const messages = { 'ai.home.title': 'اقتراحات المساعد اليوم', 'ai.home.ask': 'اسأل المساعد', 'home.banner.idle': 'اسأل عن عملائك ومهامك واجتماعاتك', 'home.banner.title': '{n} أشياء تستحق وقتك اليوم' }

interface Row { id: string; label: string; to: string; tone: 'urgent' | 'normal'; module: string }
const row = (id: string): Row => ({ id, label: `بند ${id}`, to: `/${id}`, tone: 'normal', module: 'tasks' })

async function render({ rows = [] as Row[], surface = true, allowed = true, apps = undefined as { id: string; icon: string }[] | undefined } = {}) {
  const useAttention = vi.fn(() => ({ rows: Vue.computed(() => rows) }))
  const html = await renderShared(file, { apps }, {}, {
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

describe('HomeAssistantBanner', () => {
  it('lists the things the platform found, each linking to its record, under a heading that counts them', async () => {
    const { html } = await render({ rows: [row('a'), row('b')] })
    expect(html).toContain('اقتراحات المساعد اليوم')
    expect(html.match(/data-testid="home-assistant-row"/g)).toHaveLength(2)
    expect(html).toMatch(/href="\/a"[^>]*>بند a</)
    expect(html).toContain('<h2')
    expect(html).toContain('2 أشياء تستحق وقتك اليوم')
  })

  it('has the ask button to the assistant surface', async () => {
    expect((await render({ rows: [row('a')] })).html).toMatch(/data-testid="home-assistant-ask"[^>]*href="\/ai"|href="\/ai"[^>]*data-testid="home-assistant-ask"/)
  })

  it('still invites a question when there is nothing to list, without an empty list', async () => {
    const { html } = await render({ rows: [] })
    expect(html).toContain('اسأل عن عملائك ومهامك واجتماعاتك')
    expect(html).not.toContain('home-assistant-rows')
    expect(html).toContain('home-assistant-ask')
  })

  it('draws the person\'s own applications as decorative tilted tiles a screen reader skips, shown from 1024px up', async () => {
    const { html } = await render({ rows: [row('a')], apps: [{ id: 'crm', icon: 'i-lucide-handshake' }, { id: 'hr', icon: 'i-lucide-users' }, { id: 'tasks', icon: 'i-lucide-check-square' }] })
    expect(html).toMatch(/data-testid="home-assistant-tiles"/)
    expect(html).toContain('aria-hidden="true"')
    for (const id of ['crm', 'hr', 'tasks']) expect(html).toContain(`data-app="${id}"`)
    expect(html).toContain('max-lg:hidden')
    expect(html).toContain('lg:grid-cols-')
  })

  it('draws no tiles when the person has no applications to show', async () => {
    expect((await render({ rows: [row('a')], apps: [] })).html).not.toContain('home-assistant-tiles')
  })

  it('is absent when the assistant surface does not exist or the user may not use it', async () => {
    expect((await render({ rows: [row('a')], surface: false })).html).not.toContain('home-assistant-banner')
    expect((await render({ rows: [row('a')], allowed: false })).html).not.toContain('home-assistant-banner')
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
