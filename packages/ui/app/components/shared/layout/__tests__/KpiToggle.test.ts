import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

const options = (shown: boolean): SharedRenderOptions => ({
  stubs: { UTooltip: Vue.defineComponent({ props: { text: String }, setup: (props, { slots }) => () => Vue.h('span', { 'data-tip': props.text }, slots.default?.()) }) },
  globals: { useKpiVisibility: () => ({ shown: Vue.ref(shown), toggle: vi.fn() }), computed: Vue.computed },
})

describe('SharedKpiToggle', () => {
  it('is a 42px soft icon button with a 1.5px border, pressed while the figures are shown, whose tooltip offers to hide them', async () => {
    const html = await renderShared('KpiToggle', {}, {}, options(true))
    expect(html).toContain('data-testid="kpi-toggle"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-label="app.toggleKpis"')
    expect(html).toContain('data-tip="app.hideKpis"')
    expect(html).toContain('i-lucide-chart-no-axes-column')
    expect(html).toContain('size-(--liwan-control-h)')
    expect(html).toContain('border-[1.5px]')
    expect(html).toContain('aria-pressed:bg-accented')
  })

  it('keeps the same name, unpressed, and offers to show them again while they are hidden', async () => {
    const html = await renderShared('KpiToggle', {}, {}, options(false))
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('aria-label="app.toggleKpis"')
    expect(html).toContain('data-tip="app.showKpis"')
  })
})
