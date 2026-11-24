import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import * as kpiTile from '../../../../utils/kpiTile'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

// SharedMetricTile is auto-imported in the app; here it is a plain element carrying what the strip hands it.
const stubs = {
  SharedMetricTile: Vue.defineComponent({
    inheritAttrs: false,
    props: { label: String, value: [String, Number], tone: String, density: String, active: Boolean, to: String },
    setup(props) { return () => Vue.h('div', { 'data-tile': props.label, 'data-density': props.density, 'data-tone': props.tone, 'data-active': props.active ? 'true' : undefined, 'data-to': props.to }, String(props.value)) },
  }),
}
const options = (shown: boolean, fullPath = '/meetings'): SharedRenderOptions => ({
  stubs,
  modules: { '../../../utils/kpiTile': kpiTile },
  globals: { useKpiVisibility: () => ({ shown: Vue.ref(shown) }), useRoute: () => ({ path: fullPath.split('?')[0], fullPath }) },
})
const tiles = [
  { id: 'a', label: 'Open', value: 4, tone: 'warning' as const },
  { id: 'b', label: 'Done', value: '12', tone: 'success' as const },
]
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

describe('SharedKpiStrip', () => {
  it('draws one compact tile per entry in the metric grid that shares the row evenly', async () => {
    const html = clean(await renderShared('KpiStrip', { tiles }, {}, options(true)))
    expect(html).toContain('liwan-kpi-grid')
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

  it('marks the matching route tile active (ignoring pagination offset) and routes a second click to clearTo', async () => {
    const linked = [
      { id: 'total', label: 'Total', value: 14, to: '/meetings' },
      { id: 'upcoming', label: 'Upcoming', value: 6, to: '/meetings?state=confirmed&date_from=2026-10-20', clearTo: '/meetings' },
      { id: 'draft', label: 'Drafts', value: 3, to: '/meetings?state=draft', clearTo: '/meetings' },
    ]
    const onTotal = clean(await renderShared('KpiStrip', { tiles: linked }, {}, options(true, '/meetings?offset=25')))
    expect(onTotal).toContain('data-tile="Total" data-density="compact" data-active="true" data-to="/meetings"')
    expect(onTotal).toContain('data-tile="Drafts" data-density="compact" data-to="/meetings?state=draft"')

    const onDraft = clean(await renderShared('KpiStrip', { tiles: linked }, {}, options(true, '/meetings?state=draft&offset=25')))
    expect(onDraft).toContain('data-tile="Drafts" data-density="compact" data-active="true" data-to="/meetings"')
    expect(onDraft).toContain('data-tile="Total" data-density="compact" data-to="/meetings"')

    const onUpcoming = clean(await renderShared('KpiStrip', { tiles: linked }, {}, options(true, '/meetings?date_from=2026-10-20&state=confirmed')))
    expect(onUpcoming).toContain('data-tile="Upcoming" data-density="compact" data-active="true" data-to="/meetings"')
  })
})
