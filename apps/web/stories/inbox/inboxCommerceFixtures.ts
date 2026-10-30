import type { InboxCommerceProduct, InboxMessage, InboxOrder } from '@liwan/contracts'

// Fixtures of the WhatsApp commerce stories: catalog products, a thread message that carries a commerce block, and orders.
export const coffee: InboxCommerceProduct = { catalog_item_id: 1, name: 'قهوة مختصة 250 غ', price: 51.75, currency: 'SAR', availability: 'in_stock', image_url: null }
export const pot: InboxCommerceProduct = { catalog_item_id: 2, name: 'دلة سفر معدنية', price: 138, currency: 'SAR', availability: 'in_stock', image_url: null }
export const grinder: InboxCommerceProduct = { catalog_item_id: 4, name: 'مطحنة يدوية', price: 241.5, currency: 'SAR', availability: 'out_of_stock', image_url: null }
export const CATALOG_ID = '9988776655443'

export const message = (overrides: Partial<InboxMessage>): InboxMessage => ({
  id: 1, direction: 'out', kind: 'product', body: '', author: { id: 5, name: 'نورة الحربي' }, template: null, delivery_state: 'delivered', error: null, attachments: [], reply_to: null,
  reactions: { customer: null, agent: null }, location: null, interactive: null, selected_option: null, automated: false, commerce: null, created_at: '2026-10-29T08:00:00Z', ...overrides,
})

export const order = (overrides: Partial<InboxOrder> = {}): InboxOrder => ({
  id: 1, conversation_id: 3, channel: { id: 1, name: 'واتساب المتجر' }, contact: { id: 2, name: 'ليلى القحطاني' }, message_id: 9, state: 'cart', reference: null,
  lines: [
    { id: 1, product_retailer_id: 'wv-101', catalog_item_id: 1, name: coffee.name, quantity: 2, cart_price: 51.75, unit_price: 51.75, currency: 'SAR', availability: 'in_stock' },
    { id: 2, product_retailer_id: 'wv-102', catalog_item_id: 2, name: pot.name, quantity: 1, cart_price: 138, unit_price: 138, currency: 'SAR', availability: 'in_stock' },
  ],
  cart_total: 241.5, cart_currency: 'SAR', total: 241.5, currency: 'SAR', price_changed: false, payment: null, pay_link_sent_at: null, created_by: null, created_at: '2026-10-29T08:00:00Z', ...overrides,
})

export const payment = (overrides: Partial<NonNullable<InboxOrder['payment']>> = {}): NonNullable<InboxOrder['payment']> => ({
  status: 'payable', refund_due: false, needs_attention: false, currency: 'SAR', amount_total: 241.5, amount_due: 241.5, expires_at: new Date(Date.now() + 45 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z'), ...overrides,
})
