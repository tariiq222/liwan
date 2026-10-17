import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

const render = (props: Record<string, unknown>) => renderShared('MetricTile', { label: 'Overdue', value: 18, icon: 'i-lucide-circle-alert', ...props }, {}, {
  stubs: { UCard: { inheritAttrs: false, props: { ui: Object }, template: '<div v-bind=\"$attrs\" :data-body=\"ui && ui.body\"><slot /></div>' } },
})

describe('SharedMetricTile', () => {
  it('keeps the default density and a neutral chip', async () => {
    const html = await render({})
    expect(html).toContain('data-density="default"')
    expect(html).toContain('bg-elevated text-primary')
    expect(html).not.toContain('order-last')
  })

  it('compact puts a round 40px chip at the end and tightens the padding', async () => {
    const html = await render({ density: 'compact', tone: 'success' })
    expect(html).toContain('data-density="compact"')
    expect(html).toContain('order-last size-11.5 rounded-full')
    expect(html).toContain('bg-status-success-soft text-status-success-foreground')
    expect(html).toContain('py-3.5')
  })

  it('only the danger tone turns the figure red, and the tile has no border or tint of its own', async () => {
    const danger = await render({ density: 'compact', tone: 'danger' })
    expect(danger).toContain('text-status-danger-foreground')
    expect(danger).toMatch(/<p class="[^"]*text-status-danger-foreground[^"]*"[^>]*>\s*18/)
    const warning = await render({ density: 'compact', tone: 'warning' })
    expect(warning).toMatch(/<p class="[^"]*text-highlighted[^"]*"[^>]*>\s*18/)
    expect(danger).not.toMatch(/data-testid="metric-tile"[^>]*(border-|bg-status)/)
  })
})
