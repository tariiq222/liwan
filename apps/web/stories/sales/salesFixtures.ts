import { MeSchema, type SalesCustomerAnswer, type SalesOrder, type SalesOrderListItem, type SalesOrderPayment, type SalesPublicPayment, type SalesPublicQuotation, type SalesSettings } from '@liwan/contracts'
import { me } from '../fixtures/pmo'

// The wire shapes the sales stories share: a draft quotation, a confirmed order, a cancelled one and an online order.
const currency = { id: 2, name: 'SAR', symbol: 'ر.س' }
const ALL_ACTIONS_OFF = { edit: false, confirm: false, cancel: false, reopen: false, lock: false, unlock: false, duplicate: true, assign: true, send: false }

export const draftOrder: SalesOrder = {
  id: 1, number: 'S00001', state: 'draft', locked: false, expired: false, source: 'staff', customer_answer: null, customer: { id: 2, name: 'مؤسسة النخيل' },
  salesperson: { id: 2, name: 'Admin', user_id: 2 }, validity_date: '2026-12-14', date: '2026-11-14T08:00:00Z',
  terms: 'الأسعار شاملة التوصيل داخل المدينة.', currency, amount_untaxed: 216, amount_tax: 32.4, amount_total: 248.4,
  lines: [
    { id: 11, kind: 'section', product: null, name: 'الباقات', quantity: 0, unit: null, unit_price: 0, discount_percent: 0, amount_untaxed: 0, amount_tax: 0, amount_total: 0 },
    { id: 12, kind: 'product', product: { id: 1, name: 'باقة أساسية' }, name: 'باقة أساسية', quantity: 2, unit: 'وحدة', unit_price: 120, discount_percent: 10, amount_untaxed: 216, amount_tax: 32.4, amount_total: 248.4 },
    { id: 13, kind: 'note', product: null, name: 'يبدأ الاشتراك من أول الشهر.', quantity: 0, unit: null, unit_price: 0, discount_percent: 0, amount_untaxed: 0, amount_tax: 0, amount_total: 0 },
  ],
  actions: { ...ALL_ACTIONS_OFF, edit: true, confirm: true, cancel: true, send: true },
  resend_refused: false,
}
export const confirmedOrder: SalesOrder = { ...draftOrder, id: 2, number: 'S00002', state: 'confirmed', actions: { ...ALL_ACTIONS_OFF, cancel: true, lock: true } }
export const onlineOrder: SalesOrder = { ...draftOrder, id: 4, number: 'S00004', state: 'confirmed', locked: true, source: 'online', salesperson: null, validity_date: null, terms: '', actions: { ...ALL_ACTIONS_OFF, assign: false } }

export const waitingAnswer: SalesCustomerAnswer = { mode: 'accept_and_sign', acceptance_confirms: false, answer: null, answered_at: null, signed_by: null, signature_method: null, decline_reason: null }
export const acceptedAnswer: SalesCustomerAnswer = { ...waitingAnswer, answer: 'accepted', answered_at: '2026-11-15T10:20:00Z', signed_by: 'منى العتيبي', signature_method: 'drawn' }
export const declinedAnswer: SalesCustomerAnswer = { ...waitingAnswer, answer: 'declined', answered_at: '2026-11-15T10:20:00Z', decline_reason: 'السعر أعلى من ميزانيتنا هذا الشهر.' }
export const sentOrder: SalesOrder = { ...draftOrder, state: 'sent', customer_answer: waitingAnswer, actions: { ...ALL_ACTIONS_OFF, confirm: true, cancel: true, reopen: true, send: true } }

const item = ({ lines: _lines, actions: _actions, resend_refused: _refused, ...rest }: SalesOrder): SalesOrderListItem => rest
export const orders: SalesOrderListItem[] = [item(draftOrder), item(confirmedOrder), { ...item(draftOrder), id: 3, number: 'S00003', state: 'cancelled' }, item(onlineOrder), { ...item(sentOrder), id: 5, number: 'S00005' }, { ...item(sentOrder), id: 6, number: 'S00006', expired: true, validity_date: '2026-11-01' }]

export const salesSettings: SalesSettings = { visibility: 'own', validity_days: 30, discount_limit_percent: 20, default_terms: 'الأسعار شاملة التوصيل داخل المدينة.', customer_answer: 'accept', acceptance_confirms: false, answered_resend: 'allow', signature_methods: 'draw_or_type', revision: 3, can_manage: true }
/** The settings of a tenant that can take payments: new quotations ask for nothing, and a percentage asks for half. */
export const salesSettingsWithPayment: SalesSettings = { ...salesSettings, payment_to_confirm: 'off', prepayment_percent: 50 }
/** A sent quotation that asks for 40% of its total (the draft order's total is 248.40), waiting for the customer to pay. */
export const orderPayment: SalesOrderPayment = {
  mode: 'percent', percent: 40, currency: 'SAR', amount_required: 99.36, amount_received: 0, amount_due: 99.36, amount_to_refund: 0, amount_refundable: 0, can_refund: false,
  status: 'payable', link: 'ready', held: null, needs_attention: false, attention: null,
}
export const publicPayment: SalesPublicPayment = { percent: 40, amount: 99.36, currency: 'SAR', pay_url: '/pay/order/5?access_token=8f1c0c1e-6a52-4d57-9d6b-2f2b2f0f4d2a', state: 'payable' }
export const salespeople = [{ id: 2, name: 'Admin', user_id: 2 }, { id: 7, name: 'مها الثبيتي', user_id: 7 }]
export const customerPicks = [
  { id: 1, name: 'منى العتيبي', is_company: false, phone_last4: '0001' },
  { id: 2, name: 'مؤسسة النخيل', is_company: true, phone_last4: '0002' },
  { id: 3, name: 'خالد الشهري', is_company: false, phone_last4: null },
]

export const SALES_ALL = ['sales.read', 'sales.quotations.manage', 'sales.orders.confirm', 'sales.discounts.approve', 'sales.documents.assign', 'sales.settings.manage']
export const meWith = (capabilities: string[]) => MeSchema.parse({ ...me, capabilities, home_capabilities: capabilities })

/** The quotation as its customer reads it at the link: sent, open for an answer, with a section, a product and a note. */
export const publicQuote: SalesPublicQuotation = {
  id: 5, number: 'S00005', state: 'sent', expired: false, company_name: 'مؤسسة ليوان', customer_name: 'مؤسسة النخيل', date: '2026-11-14T08:00:00Z', validity_date: '2026-12-14',
  terms: 'الأسعار شاملة التوصيل داخل المدينة.\nالدفع خلال ٣٠ يومًا من تاريخ التأكيد.', currency,
  amount_untaxed: 216, amount_tax: 32.4, amount_total: 248.4,
  lines: draftOrder.lines.map(({ id: _id, product: _product, ...line }) => line),
  answer_mode: 'accept', signature_methods: 'draw_or_type', answer: null, answered_at: null, signed_by: null, can_accept: true, can_decline: true,
}
