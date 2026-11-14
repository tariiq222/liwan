import { MeSchema, type SalesOrder, type SalesOrderListItem, type SalesSettings } from '@liwan/contracts'
import { me } from '../fixtures/pmo'

// The wire shapes the sales stories share: a draft quotation, a confirmed order, a cancelled one and an online order.
const currency = { id: 2, name: 'SAR', symbol: 'ر.س' }
const ALL_ACTIONS_OFF = { edit: false, confirm: false, cancel: false, reopen: false, lock: false, unlock: false, duplicate: true, assign: true }

export const draftOrder: SalesOrder = {
  id: 1, number: 'S00001', state: 'draft', locked: false, source: 'staff', customer: { id: 2, name: 'مؤسسة النخيل' },
  salesperson: { id: 2, name: 'Admin', user_id: 2 }, validity_date: '2026-12-14', date: '2026-11-14T08:00:00Z',
  terms: 'الأسعار شاملة التوصيل داخل المدينة.', currency, amount_untaxed: 216, amount_tax: 32.4, amount_total: 248.4,
  lines: [
    { id: 11, kind: 'section', product: null, name: 'الباقات', quantity: 0, unit: null, unit_price: 0, discount_percent: 0, amount_untaxed: 0, amount_tax: 0, amount_total: 0 },
    { id: 12, kind: 'product', product: { id: 1, name: 'باقة أساسية' }, name: 'باقة أساسية', quantity: 2, unit: 'وحدة', unit_price: 120, discount_percent: 10, amount_untaxed: 216, amount_tax: 32.4, amount_total: 248.4 },
    { id: 13, kind: 'note', product: null, name: 'يبدأ الاشتراك من أول الشهر.', quantity: 0, unit: null, unit_price: 0, discount_percent: 0, amount_untaxed: 0, amount_tax: 0, amount_total: 0 },
  ],
  actions: { ...ALL_ACTIONS_OFF, edit: true, confirm: true, cancel: true },
}
export const confirmedOrder: SalesOrder = { ...draftOrder, id: 2, number: 'S00002', state: 'confirmed', actions: { ...ALL_ACTIONS_OFF, cancel: true, lock: true } }
export const onlineOrder: SalesOrder = { ...draftOrder, id: 4, number: 'S00004', state: 'confirmed', locked: true, source: 'online', salesperson: null, validity_date: null, terms: '', actions: { ...ALL_ACTIONS_OFF, assign: false } }

const item = ({ lines: _lines, actions: _actions, ...rest }: SalesOrder): SalesOrderListItem => rest
export const orders: SalesOrderListItem[] = [item(draftOrder), item(confirmedOrder), { ...item(draftOrder), id: 3, number: 'S00003', state: 'cancelled' }, item(onlineOrder)]

export const salesSettings: SalesSettings = { visibility: 'own', validity_days: 30, discount_limit_percent: 20, default_terms: 'الأسعار شاملة التوصيل داخل المدينة.', revision: 3, can_manage: true }
export const salespeople = [{ id: 2, name: 'Admin', user_id: 2 }, { id: 7, name: 'مها الثبيتي', user_id: 7 }]
export const customerPicks = [
  { id: 1, name: 'منى العتيبي', is_company: false, phone_last4: '0001' },
  { id: 2, name: 'مؤسسة النخيل', is_company: true, phone_last4: '0002' },
  { id: 3, name: 'خالد الشهري', is_company: false, phone_last4: null },
]

export const SALES_ALL = ['sales.read', 'sales.quotations.manage', 'sales.orders.confirm', 'sales.discounts.approve', 'sales.documents.assign', 'sales.settings.manage']
export const meWith = (capabilities: string[]) => MeSchema.parse({ ...me, capabilities, home_capabilities: capabilities })
