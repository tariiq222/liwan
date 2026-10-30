import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import InboxOrderCard from '../../app/components/inbox/InboxOrderCard.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'
import { order, payment } from './inboxCommerceFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['inbox.conversations.read', 'inbox.orders.manage'] }))
const readOnly = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['inbox.conversations.read'] }))

const meta = {
  title: 'Inbox/InboxOrderCard',
  component: InboxOrderCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/inbox/InboxOrderPanel.vue:24', 'طلب واحد: المرجع وشارة الحالة أو الدفع، البنود بأسعار اليوم، تنبيه تغيّر الأسعار، مهلة الدفع، وإجراءات من يملك إدارة الطلبات.'),
    msw: { handlers: { api: [manage] } },
  },
  args: { order: order(), windowOpen: true },
} satisfies Meta<typeof InboxOrderCard>
export default meta
type Story = StoryObj<typeof meta>

export const Cart: Story = {}
export const CartWindowClosed: Story = { args: { windowOpen: false } }
export const CartPriceChanged: Story = {
  args: { order: order({ price_changed: true, cart_total: 200, total: 241.5, lines: order().lines.map(line => ({ ...line, cart_price: 45 })) }) },
}
export const CartUnknownProduct: Story = {
  args: { order: order({ lines: [...order().lines, { id: 3, product_retailer_id: 'x-9', catalog_item_id: null, name: null, quantity: 1, cart_price: 10, unit_price: null, currency: 'SAR', availability: null }] }) },
}
export const CartOutOfStock: Story = {
  args: { order: order({ lines: order().lines.map(line => ({ ...line, availability: 'out_of_stock' as const })) }) },
}
export const AwaitingPayment: Story = {
  args: { order: order({ state: 'ordered', reference: 'S00012', payment: payment(), pay_link_sent_at: '2026-10-29T08:05:00Z' }), now: Date.now() },
}
export const Expired: Story = {
  args: { order: order({ state: 'ordered', reference: 'S00012', payment: payment({ expires_at: '2026-10-29T07:00:00Z' }) }), now: Date.parse('2026-10-29T08:00:00Z') },
}
export const Paid: Story = { args: { order: order({ state: 'ordered', reference: 'S00012', payment: payment({ status: 'paid', amount_due: 0 }) }) } }
export const RefundDue: Story = { args: { order: order({ state: 'ordered', reference: 'S00012', payment: payment({ status: 'cancelled', refund_due: true }) }) } }
export const NeedsAttention: Story = { args: { order: order({ state: 'ordered', reference: 'S00012', payment: payment({ status: 'processing', needs_attention: true }) }) } }
export const Dismissed: Story = { args: { order: order({ state: 'dismissed' }) } }
export const ReadOnlyViewer: Story = { parameters: { msw: { handlers: { api: [readOnly] } } } }
export const WithContext: Story = { args: { showContext: true } }
