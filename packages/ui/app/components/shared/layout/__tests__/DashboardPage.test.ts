import { defineComponent, h, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

// The page frame components are auto-imported in the app; here they are plain elements
// so the test reads only what DashboardPage itself renders.
const stubs = {
  SharedPageContainer: defineComponent({
    inheritAttrs: false,
    props: { width: String },
    setup(props, { attrs, slots }) { return () => h('div', { ...attrs, 'data-layout-width': props.width }, slots.default?.()) },
  }),
  SharedPageHeader: defineComponent({
    props: { title: String, description: String, hideTitle: Boolean },
    setup(props, { slots }) {
      return () => h('header', { 'data-hide-title': props.hideTitle || undefined }, [
        props.hideTitle ? null : h('h1', props.title),
        props.description && !props.hideTitle ? h('p', props.description) : null,
        slots.actions ? h('div', { 'data-actions': '' }, slots.actions()) : null,
      ])
    },
  }),
}
// The user's KPI preference (a Nuxt auto-import in the app); the page reads it only to hide its metric row.
const withKpis = (shown: boolean) => ({ stubs, globals: { useKpiVisibility: () => ({ shown: ref(shown) }) } })
const chart = () => h('svg', { 'data-chart': '' })

describe('SharedChartPanel', () => {
  it('is a section named by its own heading, with the description and the chart', async () => {
    const html = await renderShared('ChartPanel', { title: 'Status', description: 'By state' }, { default: chart })
    const id = html.match(/<h2 id="([^"]+)"/)?.[1]
    expect(id).toBeTruthy()
    expect(html.startsWith('<section')).toBe(true)
    expect(html).toContain(`aria-labelledby="${id}"`)
    expect(html).toContain('data-template="chart-panel"')
    expect(html).toContain('By state')
    expect(html).toContain('data-chart')
    expect(html).not.toContain('aria-busy')
  })

  it('shows a labelled loading placeholder instead of the chart', async () => {
    const html = await renderShared('ChartPanel', { title: 'Status', loading: true }, { default: chart })
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="app.loading"')
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('data-chart')
  })

  it('shows one empty line instead of an empty chart, and loading wins over empty', async () => {
    const empty = await renderShared('ChartPanel', { title: 'Status', empty: true }, { default: chart })
    expect(empty).toContain('states.chartEmpty')
    expect(empty).not.toContain('data-chart')
    const both = await renderShared('ChartPanel', { title: 'Status', empty: true, loading: true }, { default: chart })
    expect(both).toContain('role="status"')
    expect(both).not.toContain('states.chartEmpty')
  })

  it('puts actions in the header and draws no actions box without them', async () => {
    const withActions = await renderShared('ChartPanel', { title: 'Finance' }, { default: chart, actions: () => h('select', { 'aria-label': 'Currency' }) })
    expect(withActions.indexOf('aria-label="Currency"')).toBeLessThan(withActions.indexOf('data-chart'))
    const bare = await renderShared('ChartPanel', { title: 'Finance' }, { default: chart })
    expect(bare).not.toContain('data-template="chart-panel-actions"')
  })
})

describe('SharedChartPanel span and size', () => {
  it('is half width at 300px by default, and full spans both columns', async () => {
    const half = await renderShared('ChartPanel', { title: 'A' }, { default: chart })
    expect(half).toContain('data-span="half"')
    expect(half).toContain('data-size="md"')
    expect(half).not.toContain('col-span-2')
    const full = await renderShared('ChartPanel', { title: 'A', span: 'full' }, { default: chart })
    expect(full).toContain('@min-[768px]:col-span-2')
  })

  it('sizes the empty and loading bodies, and hands the chart its height', async () => {
    const heights = { sm: '224px', md: '300px', lg: '360px' }
    for (const [size, height] of Object.entries(heights)) {
      expect(await renderShared('ChartPanel', { title: 'A', size, empty: true }, { default: chart }), size).toContain(`min-height:${height}`)
      expect(await renderShared('ChartPanel', { title: 'A', size, loading: true }, { default: chart }), size).toContain(`min-height:${height}`)
      let received = ''
      await renderShared('ChartPanel', { title: 'A', size }, { default: ((slot: { height: string }) => { received = slot.height; return chart() }) as never })
      expect(received, size).toBe(height)
    }
  })

  it('titles follow the panel heading ladder (text-sm, never text-lg)', async () => {
    const html = await renderShared('ChartPanel', { title: 'A' }, { default: chart })
    expect(html).toContain('text-sm font-semibold')
    expect(html).not.toContain('text-lg')
  })
})

describe('SharedDashboardPage', () => {
  it('renders header, labelled metric row and chart grid in that order', async () => {
    const html = await renderShared('DashboardPage', { title: 'Projects dashboard', description: 'All projects' }, {
      actions: () => h('button', 'Export'),
      metrics: () => [h('div', { 'data-metric': '' }, '4'), h('div', { 'data-metric': '' }, '2')],
      default: () => h('section', { 'data-chart-panel': '' }),
    }, withKpis(true))
    expect(html).toContain('data-template="dashboard-page"')
    expect(html).toContain('data-layout-width="list"')
    expect(html).toContain('<h1>Projects dashboard</h1>')
    // Slot content renders inside SSR fragment markers (<!--[-->…<!--]-->).
    expect(html).toMatch(/<div data-actions(?:="")?>(?:<!--\[-->)?<button>Export<\/button>/)
    expect(html).toContain('aria-label="states.metrics"')
    const order = ['<h1>', 'data-template="dashboard-metrics"', 'data-template="dashboard-charts"', 'data-chart-panel']
    const positions = order.map(marker => html.indexOf(marker))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(html).toContain('@min-[768px]:grid-cols-2')
    expect(html).toContain('gap-(--webvue-gap-card)')
    expect(html).not.toMatch(/\bgap-[356]\b/)
  })

  it('draws the primary slot full width after the filters and above the metrics', async () => {
    const html = await renderShared('DashboardPage', { title: 'Overview' }, {
      filters: () => h('div', { 'data-filter-bar': '' }),
      primary: () => h('section', { 'data-primary-block': '' }),
      metrics: () => h('div', { 'data-metric': '' }),
      default: () => h('section', { 'data-chart-panel': '' }),
    }, withKpis(true))
    const order = ['<h1>', 'data-filter-bar', 'data-template="dashboard-primary"', 'data-primary-block', 'data-template="dashboard-metrics"', 'data-chart-panel']
    const positions = order.map(marker => html.indexOf(marker))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    const without = await renderShared('DashboardPage', { title: 'Overview' }, { default: () => h('section') }, withKpis(true))
    expect(without).not.toContain('dashboard-primary')
  })

  it('omits the metric row and the actions when their slots are not given', async () => {
    const html = await renderShared('DashboardPage', { title: 'Overview' }, { default: () => h('section', { 'data-chart-panel': '' }) }, withKpis(true))
    expect(html).not.toContain('dashboard-metrics')
    expect(html).not.toContain('data-actions')
    expect(html).toContain('data-chart-panel')
  })

  it('draws the filters between the header and the metric row', async () => {
    const html = await renderShared('DashboardPage', { title: 'Overview' }, {
      filters: () => h('div', { 'data-filter-bar': '' }),
      metrics: () => h('div', { 'data-metric': '' }),
      default: () => h('section', { 'data-chart-panel': '' }),
    }, withKpis(true))
    const order = ['<h1>', 'data-template="dashboard-filters"', 'data-filter-bar', 'data-template="dashboard-metrics"']
    const positions = order.map(marker => html.indexOf(marker))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('omits the filter wrapper without a filters slot', async () => {
    const html = await renderShared('DashboardPage', { title: 'Overview' }, { default: () => h('section') }, withKpis(true))
    expect(html).not.toContain('dashboard-filters')
  })

  it('hideHeader hands hideTitle to the header and keeps the actions', async () => {
    const html = await renderShared('DashboardPage', { title: 'Overview', hideHeader: true }, {
      actions: () => h('button', 'Export'),
      default: () => h('section', { 'data-chart-panel': '' }),
    }, withKpis(true))
    expect(html).toContain('data-hide-title')
    expect(html).not.toContain('<h1>')
    expect(html).toContain('Export')
    expect(html).toContain('data-chart-panel')
  })

  it('hides the metric row with the user\'s KPI choice only when the page marks it as its strip (kpiToggle)', async () => {
    const slots = { metrics: () => h('div', { 'data-tile': '' }), default: () => h('section') }
    expect(await renderShared('DashboardPage', { title: 'Overview', kpiToggle: true }, slots, withKpis(false))).not.toContain('data-tile')
    expect(await renderShared('DashboardPage', { title: 'Overview', kpiToggle: true }, slots, withKpis(true))).toContain('data-tile')
    expect(await renderShared('DashboardPage', { title: 'Overview' }, slots, withKpis(false))).toContain('data-tile')
  })
})
