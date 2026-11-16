import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const link = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('a', { href: attrs.to }, slots.default?.()) })
const badge = Vue.defineComponent({ inheritAttrs: false, props: ['label'], setup: props => () => Vue.h('span', { 'data-badge': props.label }) })
const section = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('section', [slots.actions?.(), slots.default?.()]) })
const state = Vue.defineComponent({ props: ['empty', 'emptyText'], setup: (props, { slots }) => () => (props.empty ? Vue.h('p', props.emptyText as string) : slots.default?.()) })
const stubs = { NuxtLink: link, SharedStatusBadge: badge, SharedRecordSection: section, SharedPageState: state }
const messages = {
  'crm.opportunities.tasks.add': 'إضافة مهمة', 'crm.opportunities.tasks.empty': 'لا مهام', 'crm.opportunities.tasks.state.open': 'مفتوحة',
  'crm.opportunities.tasks.due': 'الموعد: {date}', 'crm.opportunities.meetings.add': 'إضافة اجتماع', 'crm.opportunities.meetings.empty': 'لا اجتماعات',
  'crm.opportunities.meetings.state.confirmed': 'مؤكد', 'crm.opportunities.orders.add': 'عرض سعر جديد', 'crm.opportunities.orders.empty': 'لا عروض',
  'crm.opportunities.orders.state.confirmed': 'طلب مؤكد', 'crm.opportunities.orders.noSalesperson': 'بلا مندوب', 'crm.opportunities.orders.winHint': 'تُربح عند التأكيد',
  'crm.opportunities.orders.blocked.noCustomer': 'اربط عميلًا', 'crm.opportunities.orders.blocked.closed': 'فرصة مغلقة', 'crm.opportunities.conversations.empty': 'لا محادثات', 'crm.opportunities.conversations.state.open': 'مفتوحة',
}
const render = (name: string, props: Record<string, unknown>) =>
  renderShared(resolve(import.meta.dirname, `../${name}.vue`), props, {}, { hydrated: true, messages, stubs, modules: { '@liwan/ui/app/composables/calendarDate': { formatCalendarDate: (value: string) => value.slice(0, 10) }, '@liwan/ui/app/utils/formatDate': { formatDateTime: (value: string) => value }, '@/utils/crmOrderGate': { OPPORTUNITY_ORDER_STATE_TONE: { draft: 'neutral', sent: 'info', confirmed: 'success', cancelled: 'destructive' } }, '@/utils/formatCurrency': { formatCurrency: (amount: number, currency: string) => `${amount} ${currency}` } } })

const task = { id: 5, name: 'اتصال متابعة', state: 'open', priority: 'normal', date_deadline: '2026-11-20T09:00:00Z', assignees: [{ id: 3, name: 'سعد' }], source: 'personal', project: null, href: '/my-tasks/5' }
const conversation = { id: 12, contact: { id: 4, name: 'منى', phone: null, email: null, erased: false }, channel: { id: 1, name: 'واتساب', kind: 'whatsapp' }, state: 'open', unread: true, last_message_at: '2026-11-14T10:00:00Z', last_message_preview: 'أريد عرض سعر' }
const meeting = { id: 8, name: 'عرض المنتج', meeting_date: '2026-11-22', state: 'confirmed', organizer: { id: 3, name: 'سعد' } }

describe('CrmOpportunityTasks', () => {
  it('lists each task with its state, assignees and a link to /my-tasks/<id>', async () => {
    const html = await render('CrmOpportunityTasks', { tasks: [task], total: 1, canWrite: false })
    expect(html).toContain('href="/my-tasks/5"')
    expect(html).toContain('اتصال متابعة')
    expect(html).toContain('data-badge="مفتوحة"')
    expect(html).toContain('سعد')
  })

  it('offers the add button only to a writer, and says so when empty', async () => {
    expect(await render('CrmOpportunityTasks', { tasks: [], total: 0, canWrite: true })).toContain('data-testid="crm-task-add"')
    const reader = await render('CrmOpportunityTasks', { tasks: [], total: 0, canWrite: false })
    expect(reader).not.toContain('crm-task-add')
    expect(reader).toContain('لا مهام')
  })
})

describe('CrmOpportunityMeetings', () => {
  it('lists each meeting with its state and a link to the meeting page', async () => {
    const html = await render('CrmOpportunityMeetings', { meetings: [meeting], total: 1, canWrite: false })
    expect(html).toContain('href="/meetings/8"')
    expect(html).toContain('data-badge="مؤكد"')
  })

  it('offers the add button only to a writer', async () => {
    expect(await render('CrmOpportunityMeetings', { meetings: [meeting], total: 1, canWrite: true })).toContain('data-testid="crm-meeting-add"')
    expect(await render('CrmOpportunityMeetings', { meetings: [meeting], total: 1, canWrite: false })).not.toContain('crm-meeting-add')
  })
})

describe('CrmOpportunityConversations', () => {
  it('lists each conversation with its channel, state and a link to the inbox', async () => {
    const html = await render('CrmOpportunityConversations', { conversations: [conversation], total: 1 })
    expect(html).toContain('href="/inbox/12"')
    expect(html).toContain('منى')
    expect(html).toContain('واتساب')
    expect(html).toContain('data-badge="مفتوحة"')
    expect(html).toContain('أريد عرض سعر')
  })

  it('says so when none is linked', async () => {
    expect(await render('CrmOpportunityConversations', { conversations: [], total: 0 })).toContain('لا محادثات')
  })
})

const order = { id: 31, number: 'S00031', state: 'confirmed', currency: { id: 2, name: 'SAR', symbol: 'ر.س' }, amount_total: 230, salesperson: { id: 2, name: 'مها', user_id: 2 } }

describe('CrmOpportunityOrders', () => {
  const props = { orders: [order], total: 1, canWrite: true, blocked: null }

  it('lists each order with its state, total and salesperson, linking to its page in Sales', async () => {
    const html = await render('CrmOpportunityOrders', props)
    expect(html).toContain('href="/sales/31"')
    expect(html).toContain('S00031')
    expect(html).toContain('data-badge="طلب مؤكد"')
    expect(html).toContain('مها')
    expect(html).toContain('230')
  })

  it('offers a new quotation only to a writer of an opportunity that takes one', async () => {
    expect(await render('CrmOpportunityOrders', props)).toContain('data-testid="crm-order-add"')
    expect(await render('CrmOpportunityOrders', { ...props, canWrite: false })).not.toContain('crm-order-add')
  })

  it('says why a new quotation is not offered, and only to a writer', async () => {
    const noCustomer = await render('CrmOpportunityOrders', { ...props, blocked: 'noCustomer' })
    expect(noCustomer).not.toContain('crm-order-add')
    expect(noCustomer).toContain('اربط عميلًا')
    expect(await render('CrmOpportunityOrders', { ...props, blocked: 'closed' })).toContain('فرصة مغلقة')
    expect(await render('CrmOpportunityOrders', { ...props, blocked: 'closed', canWrite: false })).not.toContain('فرصة مغلقة')
  })

  it('tells that an order wins the opportunity while one does, and says so when empty', async () => {
    expect(await render('CrmOpportunityOrders', { ...props, winByOrder: true })).toContain('تُربح عند التأكيد')
    expect(await render('CrmOpportunityOrders', props)).not.toContain('crm-orders-win')
    expect(await render('CrmOpportunityOrders', { ...props, orders: [], total: 0 })).toContain('لا عروض')
  })
})
