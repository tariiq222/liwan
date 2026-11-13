import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const component = resolve(__dirname, '../PaymentSuspendedBanner.vue')
const messages = {
  'subscription.suspended.title': 'الاشتراك موقوف لوجود فاتورة غير مسددة',
  'subscription.suspended.description': 'للقراءة والتصدير فقط',
  'subscription.suspended.descriptionMember': 'تواصل مع مسؤول الاشتراك',
  'subscription.suspended.pay': 'ادفع الآن',
}
// The Nuxt UI alert is a primitive: the stub keeps the action buttons the component hands it.
const UAlert = Vue.defineComponent({
  inheritAttrs: false,
  props: { title: String, description: String, actions: Array },
  setup(props, { attrs }) {
    return () => Vue.h('div', attrs, [
      Vue.h('p', props.title), Vue.h('p', props.description),
      ...((props.actions ?? []) as { label: string, to: string }[]).map(action => Vue.h('a', { href: action.to }, action.label)),
    ])
  },
})
const render = (canPay: boolean) => renderShared(component, { canPay }, {}, { messages, stubs: { UAlert } })

describe('PaymentSuspendedBanner', () => {
  it('tells the subscription manager the workspace is read-only and offers payment', async () => {
    const html = await render(true)
    expect(html).toContain('data-testid="payment-suspended-banner"')
    expect(html).toContain('الاشتراك موقوف لوجود فاتورة غير مسددة')
    expect(html).toContain('للقراءة والتصدير فقط')
    expect(html).toContain('<a href="/subscription">ادفع الآن</a>')
  })

  it('shows every other user the reason without a pay action', async () => {
    const html = await render(false)
    expect(html).toContain('تواصل مع مسؤول الاشتراك')
    expect(html).not.toContain('ادفع الآن')
  })
})
