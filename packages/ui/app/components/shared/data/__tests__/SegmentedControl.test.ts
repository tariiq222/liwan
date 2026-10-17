import { defineComponent, h, type Component } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

const TooltipStub = defineComponent({ props: { text: String }, setup: (props, { slots }) => () => h('span', { 'data-tooltip': props.text }, slots.default?.()) })
const ITEMS = [
  { value: 'open', label: 'Open', testId: 'scope-open' },
  { value: 'closed', label: 'Closed' },
]
const render = (props: Record<string, unknown>, hydrated = true) =>
  renderShared('SegmentedControl', { items: ITEMS, label: 'Scope', modelValue: 'open', ...props }, {}, { hydrated, stubs: { UTooltip: TooltipStub as Component } })

describe('SharedSegmentedControl', () => {
  it('is a named group of pills with the chosen one pressed and soft', async () => {
    const html = await render({})
    expect(html).toContain('role="group" aria-label="Scope"')
    expect(html).toContain('rounded-full')
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*data-value="open"[^>]*>/)
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*data-value="closed"[^>]*>/)
  })

  it('keeps an item test id on its button only when it has one', async () => {
    const html = await render({})
    expect(html.match(/data-testid=/g)).toHaveLength(1)
    expect(html).toContain('data-testid="scope-open"')
  })

  it('waits for hydration and honours disabled', async () => {
    expect((await render({}, false)).match(/<button[^>]* disabled/g)).toHaveLength(2)
    expect((await render({ disabled: true })).match(/<button[^>]* disabled/g)).toHaveLength(2)
    expect((await render({ items: [{ ...ITEMS[0]!, disabled: true }, ITEMS[1]] })).match(/<button[^>]* disabled/g)).toHaveLength(1)
  })

  it('draws icon-only items with an accessible name and a tooltip, and a block group fills its row', async () => {
    const html = await render({ iconOnly: true, block: true, items: [{ value: 'table', label: 'Table view', icon: 'i-lucide-list' }] })
    expect(html).toContain('data-tooltip="Table view"')
    expect(html).toMatch(/<button[^>]*aria-label="Table view"/)
    expect(html).toContain('auto-cols-fr')
  })

  it('emits the chosen value on click', async () => {
    const onUpdate = vi.fn()
    const clicks = new Map<string, () => void>()
    const UButton = defineComponent({
      inheritAttrs: false,
      props: { label: String },
      setup(props, { attrs }) {
        clicks.set(String(attrs['data-value']), attrs.onClick as () => void)
        return () => h('button', null, props.label)
      },
    })
    await renderShared('SegmentedControl', { items: ITEMS, label: 'Scope', modelValue: 'open', 'onUpdate:modelValue': onUpdate }, {}, { stubs: { UTooltip: TooltipStub as Component, UButton } })
    clicks.get('closed')!()
    expect(onUpdate).toHaveBeenCalledWith('closed')
  })
})
