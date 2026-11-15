import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const filename = resolve(import.meta.dirname, '../CustomerLinkBlock.vue')
const Step = Vue.defineComponent({ props: ['candidates', 'description', 'confirmLabel'], setup: props => () => Vue.h('div', { 'data-testid': 'conflict-step', 'data-count': (props.candidates as unknown[]).length, 'data-confirm': props.confirmLabel }) })
const messages = {
  'customers.link.none': 'غير مرتبط بعميل.',
  'customers.link.action': 'إنشاء عميل من هذه البيانات',
  'customers.link.open': 'فتح العميل {name}',
  'customers.link.conflictDescription': 'يوجد عملاء بهذا الرقم',
  'customers.link.conflictConfirm': 'ربط',
}
const render = (props: Record<string, unknown>) => renderShared(filename, { canLink: true, ...props }, {}, {
  hydrated: true,
  messages,
  modules: { '@/components/customers/CustomerConflictStep.vue': { __esModule: true, default: Step } },
  stubs: { NuxtLink: Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('a', { href: attrs.to, 'aria-label': attrs['aria-label'] }, slots.default?.()) }) },
})

describe('CustomerLinkBlock', () => {
  it('shows the linked customer as a link to its page for a reader of customers', async () => {
    const html = await render({ customer: { id: 4, name: 'منى العتيبي' }, canOpen: true })
    expect(html).toContain('href="/customers/4"')
    expect(html).toContain('منى العتيبي')
    expect(html).not.toContain('customer-link-action')
  })

  it('shows the name alone when the user may not open customers', async () => {
    const html = await render({ customer: { id: 4, name: 'منى العتيبي' } })
    expect(html).toContain('منى العتيبي')
    expect(html).not.toContain('href=')
  })

  it('offers the link action for an unlinked record, and none to a user who may not link', async () => {
    expect(await render({ customer: null })).toContain('data-testid="customer-link-action"')
    const readOnly = await render({ customer: null, canLink: false })
    expect(readOnly).toContain('غير مرتبط بعميل.')
    expect(readOnly).not.toContain('customer-link-action')
  })

  it('replaces the action with the candidates step when customers share the phone', async () => {
    const html = await render({ customer: null, candidates: [{ id: 7, name: 'منى', phone_last4: '4567' }] })
    expect(html).toContain('data-testid="conflict-step"')
    expect(html).toContain('data-count="1"')
    expect(html).toContain('data-confirm="ربط"')
    expect(html).not.toContain('customer-link-action')
  })

  it('shows a refusal under the block', async () => {
    expect(await render({ customer: null, error: 'تعذّر الربط' })).toContain('تعذّر الربط')
  })
})
