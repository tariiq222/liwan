import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

// UProgress stand-in: it reports the props the wrapper hands the library.
const UProgress = defineComponent({
  inheritAttrs: false,
  props: { modelValue: Number, size: String, color: String, ui: Object },
  setup(props) {
    return () => h('div', { role: 'progressbar', 'aria-valuenow': props.modelValue, 'data-size': props.size, 'data-color': props.color, 'data-complete': (props.ui as { indicator?: string } | undefined)?.indicator })
  },
})
const render = (props: Record<string, unknown>) => renderShared('Progress', { value: 40, ...props }, {}, { stubs: { UProgress } })

describe('SharedProgress', () => {
  it('draws one UProgress with the value, the sm size and the primary tone by default', async () => {
    const html = await render({})
    expect(html).toContain('aria-valuenow="40"')
    expect(html).toContain('data-size="sm"')
    expect(html).toContain('data-color="primary"')
    expect(html).not.toContain('role="group"')
  })

  it('clamps and rounds the value, and draws nothing for a missing or non-numeric one', async () => {
    expect(await render({ value: 180 })).toContain('aria-valuenow="100"')
    expect(await render({ value: -5 })).toContain('aria-valuenow="0"')
    expect(await render({ value: 33.6 })).toContain('aria-valuenow="34"')
    expect(await render({ value: 0 })).toContain('aria-valuenow="0"')
    for (const value of [Number.NaN, undefined, null]) expect(await render({ value }), String(value)).not.toContain('progressbar')
  })

  it('maps the tones to the library colours and keeps a finished non-primary bar in its tone', async () => {
    expect(await render({ tone: 'danger' })).toContain('data-color="error"')
    expect(await render({ tone: 'success' })).toContain('data-color="success"')
    expect(await render({ tone: 'warning' })).toContain('data-color="warning"')
    expect(await render({ tone: 'neutral' })).toContain('data-color="neutral"')
    expect(await render({ tone: 'danger' })).toContain('data-[state=complete]:bg-error')
    expect(await render({})).toContain('data-[state=complete]:bg-primary')
  })

  it('passes the md size and names the bar as a group when given a label', async () => {
    const html = await render({ size: 'md', label: 'Completion' })
    expect(html).toContain('data-size="md"')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Completion"')
  })
})
