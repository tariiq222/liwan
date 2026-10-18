import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

// A button stand-in that keeps each click handler, keyed by testid, aria-label or label,
// so an emit can be fired without a DOM.
const clicks = new Map<string, () => void>()
const UButton = defineComponent({
  inheritAttrs: false,
  props: { label: String, variant: String, disabled: Boolean },
  setup(props, { attrs, slots }) {
    const key = String(attrs['data-testid'] ?? attrs['aria-label'] ?? props.label)
    if (typeof attrs.onClick === 'function') clicks.set(key, attrs.onClick as () => void)
    return () => h('button', { ...attrs, 'data-variant': props.variant, disabled: props.disabled || undefined }, slots.default?.() ?? props.label)
  },
})
const stubs = {
  UButton,
  UTooltip: defineComponent({ setup: (_, { slots }) => () => slots.default?.() }),
  SharedPageContainer: defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => h('div', attrs, slots.default?.()) } }),
  SharedPageHeader: defineComponent({
    props: { title: String, hideTitle: Boolean },
    setup(props, { slots }) {
      return () => h('header', { 'data-hide-title': props.hideTitle || undefined }, [props.hideTitle ? null : h('h1', props.title), slots.actions ? h('div', { 'data-actions': '' }, slots.actions()) : null])
    },
  }),
}
const SCALES = [{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]
const render = (props: Record<string, unknown>, hydrated = true) => {
  clicks.clear()
  return renderShared('TimelineFrame', { title: 'Calendar', rangeLabel: 'October 2026', ...props }, { default: () => h('div', { 'data-body': '' }) }, { stubs, hydrated })
}

describe('SharedTimelineFrame', () => {
  it('orders previous, the live range, today and next, then the body', async () => {
    const html = await render({})
    const order = ['<h1>Calendar</h1>', 'timeline-prev', 'timeline-range', 'timeline-today', 'timeline-next', 'data-body']
    const positions = order.map(marker => html.indexOf(marker))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(html).toMatch(/aria-live="polite"[^>]*>October 2026</)
    expect(html).toContain('aria-label="states.previous"')
    expect(html).toContain('aria-label="states.next"')
    expect(html).toContain('states.today')
    expect(html).toContain('aria-label="states.period"')
  })

  it('points both chevrons along the reading direction and mirrors them in RTL', async () => {
    const html = await render({})
    expect(html).toMatch(/timeline-prev[\s\S]*?i-lucide-chevron-left/)
    expect(html).toMatch(/timeline-next[\s\S]*?i-lucide-chevron-right/)
    expect(html.match(/rtl:-scale-x-100/g)).toHaveLength(2)
    expect(html).not.toContain('rotate-180')
  })

  it('emits prev, today and next', async () => {
    const onPrev = vi.fn()
    const onToday = vi.fn()
    const onNext = vi.fn()
    await render({ onPrev, onToday, onNext })
    clicks.get('timeline-prev')!()
    clicks.get('timeline-today')!()
    clicks.get('timeline-next')!()
    expect([onPrev, onToday, onNext].map(spy => spy.mock.calls.length)).toEqual([1, 1, 1])
  })

  it('shows the scale switch only with scales, marks the current one and emits only a change', async () => {
    expect(await render({})).not.toContain('timeline-scale')
    const onScale = vi.fn()
    const html = await render({ scales: SCALES, scale: 'week', 'onUpdate:scale': onScale })
    expect(html).toContain('role="group" aria-label="states.scale"')
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toMatch(/<button[^>]*(?:text-primary[^>]*aria-pressed="true"|aria-pressed="true"[^>]*text-primary)[^>]*>Week</)
    clicks.get('Week')!()
    expect(onScale).not.toHaveBeenCalled()
    clicks.get('Month')!()
    expect(onScale).toHaveBeenCalledWith('month')
  })

  it('keeps every control disabled until hydrated', async () => {
    const html = await render({ scales: SCALES, scale: 'week' }, false)
    const buttons = html.match(/<button[^>]*>/g) ?? []
    expect(buttons).toHaveLength(5)
    expect(buttons.every(tag => / disabled/.test(tag))).toBe(true)
  })

  it('hideTitle passes through so a frame-owned page draws no second heading', async () => {
    const html = await render({ hideHeader: true })
    expect(html).toContain('data-hide-title')
    expect(html).not.toContain('<h1>Calendar</h1>')
    expect(html).toContain('timeline-prev')
    expect(html).toContain('data-body')
  })
})
