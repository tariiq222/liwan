import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { loadShared, renderShared } from '../../../../../test/helpers/renderShared'

// SharedProgress is the real component over a UProgress stand-in that renders the progressbar semantics the library gives it.
const UProgress = defineComponent({
  inheritAttrs: false,
  props: { modelValue: Number, size: String, color: String },
  setup(props) { return () => h('div', { role: 'progressbar', 'aria-valuenow': props.modelValue, style: `width:${props.modelValue}%`, 'data-color': props.color }) },
})
const render = (props: Record<string, unknown>) => renderShared('MetricTile', { label: 'Overdue', value: 18, icon: 'i-lucide-circle-alert', ...props }, {}, {
  stubs: {
    UCard: { inheritAttrs: false, props: { ui: Object }, template: '<div v-bind=\"$attrs\" :data-body=\"ui && ui.body\"><slot /></div>' },
    UProgress,
    SharedProgress: loadShared('Progress'),
  },
})

describe('SharedMetricTile', () => {
  it('keeps the default density and a neutral chip', async () => {
    const html = await render({})
    expect(html).toContain('data-density="default"')
    expect(html).toContain('bg-elevated text-primary')
    expect(html).not.toContain('order-last')
  })

  it('compact puts a round chip at the end from sm, tightens the padding and shrinks the figure on a phone', async () => {
    const html = await render({ density: 'compact', tone: 'success' })
    expect(html).toContain('data-density="compact"')
    expect(html).toContain('order-last hidden size-11.5 rounded-full sm:flex')
    expect(html).toContain('text-xl/7 sm:text-2xl/8.5')
    expect(html).toContain('bg-status-success-soft text-status-success-foreground')
    expect(html).toContain('py-3.5')
  })

  it('lets a currency code wrap under its amount', async () => {
    const html = await render({ density: 'compact', value: '1,604,300.00\u00A0SAR' })
    expect(html).toContain('1,604,300.00 SAR')
    expect(html).not.toContain('\u00A0SAR')
  })

  it('draws a clamped progress bar in the tone colour, and none when undefined', async () => {
    const half = await render({ density: 'compact', tone: 'success', progress: 50 })
    expect(half).toContain('role="progressbar"')
    expect(half).toContain('aria-valuenow="50"')
    expect(half).toContain('aria-label="Overdue"')
    expect(half).toContain('data-color="success"')
    expect(half).toContain('width:50%')
    expect(await render({ progress: 180 })).toContain('aria-valuenow="100"')
    expect(await render({ progress: -5 })).toContain('aria-valuenow="0"')
    expect(await render({ progress: Number.NaN })).not.toContain('progressbar')
    expect(await render({})).not.toContain('progressbar')
  })

  it('only the danger tone turns the figure red, and the tile has no border or tint of its own', async () => {
    const danger = await render({ density: 'compact', tone: 'danger' })
    expect(danger).toContain('text-status-danger-foreground')
    expect(danger).toMatch(/<p class="[^"]*text-status-danger-foreground[^"]*"[^>]*>\s*18/)
    const warning = await render({ density: 'compact', tone: 'warning' })
    expect(warning).toMatch(/<p class="[^"]*text-highlighted[^"]*"[^>]*>\s*18/)
    expect(danger).not.toMatch(/data-testid="metric-tile"[^>]*(border-|bg-status)/)
  })

  it('emphasis enlarges the figure and tints the neutral chip with the brand', async () => {
    const html = await render({ emphasis: true })
    expect(html).toContain('data-emphasis="true"')
    expect(html).toContain('text-3xl/10')
    expect(html).toContain('bg-primary/10 text-primary')
    expect(html).not.toContain('bg-elevated text-primary')
    const warning = await render({ emphasis: true, tone: 'warning' })
    expect(warning).toContain('bg-status-warning-soft')
    expect(await render({})).not.toContain('data-emphasis')
  })

  it('to makes the tile a named link, and a plain tile has no link', async () => {
    const link = await render({ to: '/tasks?state=overdue' })
    expect(link).toContain('to="/tasks?state=overdue"')
    expect(link).toContain('aria-label="Overdue: 18"')
    expect(link).toContain('hover:bg-(--liwan-row-hover)')
    const plain = await render({})
    expect(plain).not.toContain('<a')
    expect(plain).not.toContain('metric-link')
  })
})
