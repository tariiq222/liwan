import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

// UFormField: label (or its slot), the required mark, the error text and the control, as Nuxt UI draws them.
const UFormField = Vue.defineComponent({
  inheritAttrs: false,
  props: { label: String, required: Boolean, error: [String, Boolean], help: String },
  setup: (props, { attrs, slots }) => () => Vue.h('div', attrs, [
    Vue.h('label', [slots.label ? slots.label() : props.label, props.required ? '*' : null]),
    slots.default?.(),
    props.error ? Vue.h('p', { 'data-testid': 'error' }, String(props.error)) : null,
  ]),
})
const UInput = Vue.defineComponent({ inheritAttrs: false, props: ['modelValue'], setup: (props, { attrs }) => () => Vue.h('input', { ...attrs, value: props.modelValue }) })
const UButton = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('button', attrs, String(attrs.label ?? '')) })
const options: SharedRenderOptions = { stubs: { UFormField, UInput, UButton } }
const props = { modelValue: '25.00', label: 'Minimum', unit: 'SAR' }

describe('SharedMoneyField', () => {
  it('draws no unit and speaks no empty parentheses when no unit is given', async () => {
    const html = await renderShared('MoneyField', { modelValue: '25.00', label: 'Minimum' }, {}, options)
    expect(html).not.toContain('money-unit')
    expect(html).not.toContain('sr-only')
    expect(html).not.toContain('()')
  })

  it('draws the number in an ltr decimal box and the unit beside it, outside the input', async () => {
    const html = await renderShared('MoneyField', props, {}, options)
    expect(html).toMatch(/<input[^>]*dir="ltr"[^>]*inputmode="decimal"|<input[^>]*inputmode="decimal"[^>]*dir="ltr"/)
    expect(html).toMatch(/<span[^>]*data-slot="money-unit"[^>]*aria-hidden="true"[^>]*>SAR<\/span>|<span[^>]*aria-hidden="true"[^>]*data-slot="money-unit"[^>]*>SAR<\/span>/)
    expect(html.indexOf('<input')).toBeLessThan(html.indexOf('money-unit'))
    expect(html).not.toContain('trailing')
  })

  it('puts the unit in the accessible name, from the prop and never from a literal', async () => {
    expect(await renderShared('MoneyField', props, {}, options)).toContain('Minimum<span class="sr-only"> (SAR)</span>')
    expect(await renderShared('MoneyField', { ...props, unitLabel: 'Saudi riyal' }, {}, options)).toContain('<span class="sr-only"> (Saudi riyal)</span>')
    expect(await renderShared('MoneyField', { ...props, unit: 'USD' }, {}, options)).toContain('(USD)')
  })

  it('uses the numeric keypad for a whole amount', async () => {
    expect(await renderShared('MoneyField', { ...props, whole: true }, {}, options)).toContain('inputmode="numeric"')
  })

  it('shows the error only once submitted, because blur has not happened in a render', async () => {
    expect(await renderShared('MoneyField', { ...props, error: 'Enter an amount' }, {}, options)).not.toContain('data-testid="error"')
    expect(await renderShared('MoneyField', { ...props, error: 'Enter an amount', submitted: true }, {}, options)).toContain('Enter an amount')
  })
})
