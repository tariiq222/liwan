import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

const UFormField = Vue.defineComponent({
  inheritAttrs: false,
  props: { label: String, required: Boolean, error: [String, Boolean], name: String },
  setup: (props, { attrs, slots }) => () => Vue.h('div', attrs, [Vue.h('label', props.label), slots.default?.(), props.error ? Vue.h('p', { 'data-testid': 'error' }, String(props.error)) : null]),
})
const options: SharedRenderOptions = { stubs: { UFormField } }
const slots = { default: () => Vue.h('input') }

describe('SharedFormField', () => {
  it('makes the field addressable by name for the error summary', async () => {
    const html = await renderShared('FormField', { name: 'minimum', label: 'Minimum' }, slots, options)
    expect(html).toContain('id="field-minimum"')
    expect(html).toContain('data-field="minimum"')
  })

  it('shows a live error only after blur or a submit attempt', async () => {
    expect(await renderShared('FormField', { name: 'a', label: 'A', error: 'Wrong' }, slots, options)).not.toContain('data-testid="error"')
    expect(await renderShared('FormField', { name: 'a', label: 'A', error: 'Wrong', submitted: true }, slots, options)).toContain('Wrong')
  })
})
