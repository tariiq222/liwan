import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import type { ShellNotice } from '../../../utils/shellNotices'

const component = resolve(__dirname, '../ShellNoticeBar.vue')
const messages = {
  'subscription.notice.paymentSuspended.manager': 'موقوف لفاتورة غير مسددة',
  'subscription.notice.paymentOverdue': 'متأخرة قبل {date} باقي {days}',
  'subscription.notice.actions.pay': 'ادفع الآن',
}
// The Nuxt UI alert is a primitive: the stub keeps what the component hands it.
const UAlert = Vue.defineComponent({
  inheritAttrs: false,
  props: { description: String, actions: Array, close: Boolean, color: String },
  setup(props, { attrs }) {
    return () => Vue.h('div', { ...attrs, 'data-color': props.color }, [
      Vue.h('p', props.description),
      ...((props.actions ?? []) as { label: string, to: string }[]).map(action => Vue.h('a', { href: action.to }, action.label)),
      props.close ? Vue.h('button', { 'data-slot': 'close' }) : null,
    ])
  },
})
const render = (notice: ShellNotice) => renderShared(component, { notice }, {}, { messages, stubs: { UAlert }, modules: { '@liwan/ui/app/utils/formatDate': { formatDate } } })

const suspended: ShellNotice = {
  key: 'payment_suspended', severity: 'error', params: {}, dismissible: false,
  messageKey: 'subscription.notice.paymentSuspended.manager', action: { labelKey: 'subscription.notice.actions.pay', to: '/subscription' },
}

describe('ShellNoticeBar', () => {
  it('draws the text and the one action of an undismissable notice, with no close button', async () => {
    const html = await render(suspended)
    expect(html).toContain('data-notice="payment_suspended"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('data-color="error"')
    expect(html).toContain('موقوف لفاتورة غير مسددة')
    expect(html).toContain('<a href="/subscription">ادفع الآن</a>')
    expect(html).not.toContain('data-slot="close"')
  })

  it('formats the date param and offers close when the notice is dismissible', async () => {
    const html = await render({
      key: 'payment_overdue', level: 'early', severity: 'warning', params: { date: '2026-12-01', days: 5 },
      messageKey: 'subscription.notice.paymentOverdue', dismissible: { hours: 24 },
    })
    expect(html).toContain('01/12/2026')
    expect(html).toContain('باقي 5')
    expect(html).toContain('role="status"')
    expect(html).toContain('data-slot="close"')
    expect(html).not.toContain('<a ')
  })
})
