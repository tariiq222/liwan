import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as appCardSurface from '../appCardSurface'

const file = resolve(import.meta.dirname, '../HomeAppCard.vue')
const NuxtLink = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' } }, setup: (props, { attrs, slots }) => () => Vue.h('a', { ...attrs, href: props.to }, slots.default?.()) })
const messages = { 'nav.crm': 'إدارة العملاء', 'launcher.open': 'فتح التطبيق', 'appStart.attention': 'يحتاج انتباهك', 'launcher.figures.crm.due': 'تحتاج متابعة', 'launcher.figures.crm.today': 'جديدة اليوم' }
const card = (extra: Record<string, unknown> = {}) => ({ id: 'crm', labelKey: 'nav.crm', icon: 'i-lucide-handshake', to: '/crm', pinnable: true, category: 'sales', plan: 'addon', surface: 'navy', figures: [], ...extra })
const figureDefs = [{ labelKey: 'launcher.figures.crm.due' }, { labelKey: 'launcher.figures.crm.today' }]
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: `بند ${id}`, to: `/r/${id}`, tone: 'normal', module: 'crm', work: 'execute', ...extra })

const cardClasses = (html: string) => html.match(/<article[^>]*class="([^"]*)"/)![1]!.split(' ')

async function render({ figures = [] as Array<{ labelKey: string; value: number }>, rows = [] as ReturnType<typeof row>[], props = {} as Record<string, unknown> } = {}) {
  const useAttention = vi.fn(() => ({ rows: Vue.computed(() => rows) }))
  const useAppFigures = vi.fn(() => Vue.computed(() => figures))
  const html = await renderShared(file, { card: card(), description: 'متابعة العملاء المحتملين', ...props }, {}, {
    messages, stubs: { ...DEFAULT_STUBS, NuxtLink },
    modules: {
      '@/components/home/appCardSurface': appCardSurface,
      '@/composables/useAppCards': { useAppFigures },
      '@/composables/useAttention': { useAttention },
    },
  })
  return { html, useAttention, useAppFigures }
}

describe('HomeAppCard', () => {
  it('shows the application tile scoped by its id, its name, its tagline and a button that opens it', async () => {
    const { html } = await render()
    expect(html).toContain('data-app="crm"')
    expect(html).toContain('liwan-app-tile')
    expect(html).toContain('>إدارة العملاء</h3>')
    expect(html).toContain('متابعة العملاء المحتملين')
    expect(html).toMatch(/href="\/crm"[^>]*data-testid="home-app-open"|data-testid="home-app-open"[^>]*href="\/crm"/)
    expect(html).toContain('>فتح التطبيق<')
  })

  it('paints the gradient of its surface in both modes and white text on a card that is dark in light mode', async () => {
    const navy = (await render()).html
    expect(navy).toContain('--card-from:#1c2b4a')
    expect(navy).toContain('--card-from-dark:#1c2b4a')
    expect(cardClasses(navy)).toContain('text-white')
    const mint = (await render({ props: { card: card({ surface: 'mint' }) } })).html
    expect(mint).toContain('--card-from:#e4fbf2')
    expect(cardClasses(mint)).toContain('text-(--liwan-ink)')
    expect(cardClasses(mint)).toContain('dark:text-white')
    expect(cardClasses(mint)).not.toContain('text-white')
  })

  it('draws the figures that arrived, each with its caption, in order', async () => {
    const { html } = await render({ props: { card: card({ figures: figureDefs }) }, figures: [{ labelKey: 'launcher.figures.crm.due', value: 6 }, { labelKey: 'launcher.figures.crm.today', value: 0 }] })
    expect(html).toContain('data-testid="home-app-figures"')
    expect(html.indexOf('>6</b>')).toBeLessThan(html.indexOf('>0</b>'))
    expect(html).toContain('تحتاج متابعة')
    expect(html).toContain('جديدة اليوم')
  })

  it('draws no figure that has not arrived, and no figures area for an application that declares none', async () => {
    const pending = (await render({ props: { card: card({ figures: figureDefs }) }, figures: [] })).html
    expect(pending).not.toMatch(/<b[^>]*>\d/)
    expect(pending).not.toContain('تحتاج متابعة')
    expect((await render()).html).not.toContain('home-app-figures')
  })

  it('previews the rows that need the person, each linking to its record, and asks for three of its own module', async () => {
    const { html, useAttention } = await render({ rows: [row('a', { tone: 'urgent', caption: 'اليوم' }), row('b')] })
    expect(html.match(/data-testid="home-app-preview-row"/g)).toHaveLength(2)
    expect(html).toContain('href="/r/a"')
    expect(html).toContain('اليوم')
    const [scope, options] = useAttention.mock.calls[0] as unknown as [() => string, { limit: number }]
    expect(scope()).toBe('crm')
    expect(options).toEqual({ limit: 3 })
  })

  it('has no preview panel when nothing in the application needs the person', async () => {
    expect((await render({ rows: [] })).html).not.toContain('home-app-preview')
  })
})
