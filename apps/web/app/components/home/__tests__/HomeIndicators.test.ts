import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'
import { WORK_KINDS, workCountLabel } from '../../../composables/nav/attentionModel'

const file = resolve(import.meta.dirname, '../HomeIndicators.vue')
const NuxtLink = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' } }, setup: (props, { attrs, slots }) => () => Vue.h('a', { ...attrs, href: props.to }, slots.default?.()) })
const messages = { 'home.indicators': 'مؤشراتي', 'home.indicator.execute': 'للتنفيذ', 'home.indicator.decide': 'للقرار', 'home.indicator.follow': 'للمتابعة' }

/** The figure and the label of one card. */
function tile(html: string, kind: string): string[] {
  const card = html.match(new RegExp(`data-testid="home-indicator-${kind}"[\\s\\S]*?</a>`))![0]
  return [card.match(/<b[^>]*>([^<]*)<\/b>/)![1]!, card.match(/<span class="mt-1[^>]*>([^<]*)<\/span>/)![1]!]
}

async function render({ available = true, pending = false, failed = false, capped = [] as string[], counts = { execute: 3, decide: 1, follow: 0 } } = {}) {
  const grouped = Object.fromEntries(Object.entries(counts).map(([kind, count]) => [kind, Array.from({ length: count }, (_, index) => ({ id: `${kind}${index}` }))]))
  return renderShared(file, {}, {}, {
    messages, stubs: { ...DEFAULT_STUBS, NuxtLink },
    modules: {
      '@/composables/nav/attentionModel': { WORK_KINDS, workCountLabel },
      '@/composables/useMyWork': { useMyWork: () => ({ available: Vue.computed(() => available), grouped: Vue.computed(() => grouped), pending: Vue.computed(() => pending), failed: Vue.computed(() => failed), cappedKinds: Vue.computed(() => capped) }) },
    },
  })
}

describe('HomeIndicators', () => {
  it('shows the three counts, each linking to its tab of the work page', async () => {
    const html = await render()
    expect(tile(html, 'execute')).toEqual(['3', 'للتنفيذ'])
    expect(tile(html, 'decide')).toEqual(['1', 'للقرار'])
    expect(tile(html, 'follow')).toEqual(['0', 'للمتابعة'])
    expect(html).toContain('href="/work?tab=execute"')
    expect(html).toContain('href="/work?tab=decide"')
    expect(html).toContain('href="/work?tab=follow"')
  })

  it('keeps fully loaded counts exact above the former aggregate limit', async () => {
    const html = await render({ counts: { execute: 133, decide: 38, follow: 0 } })
    expect(tile(html, 'execute')[0]).toBe('133')
    expect(tile(html, 'decide')[0]).toBe('38')
    expect(html).not.toContain('+')
  })

  it('adds a plus to a kind whose provider returned all it may', async () => {
    const html = await render({ capped: ['decide'], counts: { execute: 3, decide: 20, follow: 0 } })
    expect(tile(html, 'decide')[0]).toBe('20+')
    expect(tile(html, 'execute')[0]).toBe('3')
  })

  it('shows no figure while loading or when every provider failed', async () => {
    expect(tile(await render({ pending: true }), 'execute')[0]).toBe('—')
    expect(tile(await render({ failed: true }), 'decide')[0]).toBe('—')
  })

  it('is hidden entirely when the user has no work page or no provider', async () => {
    expect(await render({ available: false })).not.toContain('home-indicators')
  })
})
