import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'
import { WORK_KINDS, workCountLabel } from '../../../composables/nav/attentionModel'

const file = resolve(import.meta.dirname, '../HomeIndicators.vue')
const SharedMetricTile = Vue.defineComponent({
  inheritAttrs: false,
  props: { label: { type: String, default: '' }, value: { type: [String, Number], default: null }, to: { type: String, default: '' } },
  setup: (props, { attrs }) => () => Vue.h('a', { ...attrs, href: props.to }, `${props.label}:${props.value ?? '—'}`),
})
const messages = { 'home.indicators': 'مؤشراتي', 'home.indicator.execute': 'للتنفيذ', 'home.indicator.decide': 'للقرار', 'home.indicator.follow': 'للمتابعة' }

async function render({ available = true, pending = false, failed = false, capped = [] as string[], counts = { execute: 3, decide: 1, follow: 0 } } = {}) {
  const grouped = Object.fromEntries(Object.entries(counts).map(([kind, count]) => [kind, Array.from({ length: count }, (_, index) => ({ id: `${kind}${index}` }))]))
  return renderShared(file, {}, {}, {
    messages, stubs: { ...DEFAULT_STUBS, SharedMetricTile },
    globals: { onMounted: Vue.onMounted },
    modules: {
      '@/composables/nav/attentionModel': { WORK_KINDS, workCountLabel },
      '@/composables/useMyWork': { useMyWork: () => ({ available: Vue.computed(() => available), grouped: Vue.computed(() => grouped), pending: Vue.computed(() => pending), failed: Vue.computed(() => failed), cappedKinds: Vue.computed(() => capped) }) },
    },
  })
}

describe('HomeIndicators', () => {
  it('shows the three counts, each linking to its tab of the work page', async () => {
    const html = await render()
    expect(html).toMatch(/href="\/work\?tab=execute"[^>]*>للتنفيذ:3</)
    expect(html).toMatch(/href="\/work\?tab=decide"[^>]*>للقرار:1</)
    expect(html).toMatch(/href="\/work\?tab=follow"[^>]*>للمتابعة:0</)
  })

  it('keeps fully loaded counts exact above the former aggregate limit', async () => {
    const html = await render({ counts: { execute: 133, decide: 38, follow: 0 } })
    expect(html).toContain('للتنفيذ:133<')
    expect(html).toContain('للقرار:38<')
    expect(html).not.toContain('+')
  })

  it('adds a plus to a kind whose provider returned all it may', async () => {
    const html = await render({ capped: ['decide'], counts: { execute: 3, decide: 20, follow: 0 } })
    expect(html).toContain('للقرار:20+')
    expect(html).toContain('للتنفيذ:3<')
  })

  it('shows no figure while loading or when every provider failed', async () => {
    expect(await render({ pending: true })).toContain('للتنفيذ:—')
    expect(await render({ failed: true })).toContain('للقرار:—')
  })

  it('is hidden entirely when the user has no work page or no provider', async () => {
    expect(await render({ available: false })).not.toContain('home-indicators')
  })
})
