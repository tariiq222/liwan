import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

// SharedMetricTile is auto-imported in the app; here it is a plain element carrying what the strip hands it.
const stubs = {
  SharedMetricTile: Vue.defineComponent({
    inheritAttrs: false,
    props: { label: String, value: [String, Number], tone: String, density: String },
    setup(props) { return () => Vue.h('div', { 'data-tile': props.label, 'data-density': props.density, 'data-tone': props.tone }, String(props.value)) },
  }),
}
const options = (shown: boolean): SharedRenderOptions => ({ stubs, globals: { useKpiVisibility: () => ({ shown: Vue.ref(shown) }) } })
const tiles = [
  { id: 'a', label: 'Open', value: 4, tone: 'warning' as const },
  { id: 'b', label: 'Done', value: '12', tone: 'success' as const },
]
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

describe('SharedKpiStrip', () => {
  it('draws one compact tile per entry in a two/four column grid', async () => {
    const html = clean(await renderShared('KpiStrip', { tiles }, {}, options(true)))
    expect(html).toContain('grid-cols-2')
    expect(html).toContain('lg:grid-cols-4')
    expect(html).toContain('data-tile="Open"')
    expect(html).toContain('data-density="compact"')
    expect(html).toContain('data-tone="success"')
    expect(html).toContain('aria-label="states.metrics"')
  })

  it('draws skeletons while loading, as many as the tiles or the skeletonCount, 4 by default', async () => {
    const count = async (props: Record<string, unknown>) => (clean(await renderShared('KpiStrip', props, {}, options(true))).match(/h-\[4\.5rem\]/g) ?? []).length
    expect(await count({ loading: true })).toBe(4)
    expect(await count({ loading: true, tiles })).toBe(2)
    expect(await count({ loading: true, tiles, skeletonCount: 3 })).toBe(3)
    expect(clean(await renderShared('KpiStrip', { loading: true, tiles }, {}, options(true)))).not.toContain('data-tile')
  })

  it('renders nothing when the user turned KPIs off', async () => {
    expect(clean(await renderShared('KpiStrip', { tiles }, {}, options(false)))).toBe('')
  })
})
