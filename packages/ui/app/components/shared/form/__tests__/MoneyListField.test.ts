import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

const UFormField = Vue.defineComponent({
  inheritAttrs: false,
  props: { label: String, required: Boolean, error: [String, Boolean] },
  setup: (props, { attrs, slots }) => () => Vue.h('div', attrs, [
    Vue.h('label', [slots.label ? slots.label() : props.label]),
    slots.default?.(),
    props.error ? Vue.h('p', { 'data-testid': 'row-error' }, String(props.error)) : null,
  ]),
})
const UInput = Vue.defineComponent({ inheritAttrs: false, props: ['modelValue'], setup: (props, { attrs }) => () => Vue.h('input', { ...attrs, value: props.modelValue }) })
const UButton = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('button', attrs, String(attrs.label ?? '')) })
const options: SharedRenderOptions = { stubs: { UFormField, UInput, UButton } }
const base = { modelValue: ['25.00', '50.00'], label: 'Top-up amounts', unit: 'SAR', rowLabel: 'Amount', addLabel: 'Add an amount', removeLabel: 'Remove' }

describe('SharedMoneyListField', () => {
  it('renders one labelled money field per amount inside one named group, with a labelled add button', async () => {
    const html = await renderShared('MoneyListField', base, {}, options)
    expect(html.match(/<input/g)).toHaveLength(2)
    expect(html).toContain('role="group"')
    expect(html).toMatch(/aria-labelledby="money-list-[^"]*-label"/)
    expect(html).toContain('Amount 1')
    expect(html).toContain('Amount 2')
    expect(html).toContain('Add an amount')
  })

  it('names which row each remove button removes, and keeps the last row', async () => {
    const html = await renderShared('MoneyListField', base, {}, options)
    expect(html).toContain('aria-label="Remove Amount 1"')
    expect(html).toContain('aria-label="Remove Amount 2"')
    const single = await renderShared('MoneyListField', { ...base, modelValue: ['25.00'] }, {}, options)
    expect(single).toMatch(/<button[^>]*aria-label="Remove Amount 1"[^>]*disabled/)
  })

  it('stops adding at the maximum', async () => {
    const disabled = async (max: number) => (await renderShared('MoneyListField', { ...base, max }, {}, options)).match(/disabled/g)?.length ?? 0
    expect(await disabled(2)).toBe((await disabled(3)) + 1)
  })

  it('puts each row error on its own row and the list error under the rows once submitted', async () => {
    const html = await renderShared('MoneyListField', { ...base, errors: [undefined, 'Not an amount'], error: 'Ascending order', submitted: true }, {}, options)
    expect(html.match(/data-testid="row-error"/g)).toHaveLength(1)
    expect(html.indexOf('Amount 2')).toBeLessThan(html.indexOf('Not an amount'))
    expect(html).toContain('Ascending order')
    expect(await renderShared('MoneyListField', { ...base, error: 'Ascending order' }, {}, options)).not.toContain('Ascending order')
  })
})
