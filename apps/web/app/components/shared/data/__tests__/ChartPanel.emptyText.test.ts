import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '../../__tests__/helpers/renderShared'

const chart = () => h('svg', { 'data-chart': '' })

describe('SharedChartPanel emptyText', () => {
  it('shows the caller sentence instead of the generic empty line', async () => {
    const html = await renderShared('ChartPanel', { title: 'Budget', empty: true, emptyText: 'No budget set yet' }, { default: chart })
    expect(html).toContain('No budget set yet')
    expect(html).not.toContain('states.chartEmpty')
    expect(html).not.toContain('data-chart')
  })

  it('falls back to the generic line for a missing, empty or blank sentence', async () => {
    for (const emptyText of [undefined, '', '   ']) {
      const html = await renderShared('ChartPanel', { title: 'Budget', empty: true, emptyText }, { default: chart })
      expect(html, JSON.stringify(emptyText)).toContain('states.chartEmpty')
    }
  })

  it('shows the chart, not the sentence, while there is data', async () => {
    const html = await renderShared('ChartPanel', { title: 'Budget', emptyText: 'No budget set yet' }, { default: chart })
    expect(html).toContain('data-chart')
    expect(html).not.toContain('No budget set yet')
  })

  it('shows the loading placeholder, not the sentence, while loading', async () => {
    const html = await renderShared('ChartPanel', { title: 'Budget', loading: true, empty: true, emptyText: 'No budget set yet' }, { default: chart })
    expect(html).toContain('role="status"')
    expect(html).not.toContain('No budget set yet')
  })
})
