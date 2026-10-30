import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import InboxCommerceMessage from '../../app/components/inbox/InboxCommerceMessage.vue'
import { me } from '../fixtures/pmo'
import { storyContext } from '../support/context'
import { CATALOG_ID, coffee, grinder, message, pot } from './inboxCommerceFixtures'

const manage = http.get('/api/v1/me', () => HttpResponse.json({ ...me, capabilities: ['inbox.conversations.read', 'inbox.orders.manage'] }))
const cartLines = [
  { product_retailer_id: 'wv-101', product: coffee, quantity: 2, item_price: 45, currency: 'SAR' },
  { product_retailer_id: 'wv-104', product: grinder, quantity: 1, item_price: 241.5, currency: 'SAR' },
  { product_retailer_id: 'x-9', product: null, quantity: 1, item_price: 10, currency: 'SAR' },
]
const cart = (order: { id: number; state: 'cart' | 'ordered' | 'dismissed'; reference: string | null; payment_status: 'payable' | 'paid' | 'cancelled' | null } | null) =>
  message({ direction: 'in', kind: 'order', author: null, delivery_state: 'received', commerce: { type: 'order', catalog_id: CATALOG_ID, text: 'أريد هذه المنتجات', lines: cartLines, order } })

const meta = {
  title: 'Inbox/InboxCommerceMessage',
  component: InboxCommerceMessage,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/inbox/InboxMessageContent.vue:75', 'ما تحمله رسالة تجارية في المحادثة: بطاقة منتج أو قائمة منتجات أو الكتالوج، وشريحة استفسار العميل عن منتج، وسلة طلب العميل بحالة طلبها وإجراءاتها.'),
    msw: { handlers: { api: [manage] } },
  },
  args: { conversationId: 3, channelId: 1, windowOpen: true },
} satisfies Meta<typeof InboxCommerceMessage>
export default meta
type Story = StoryObj<typeof meta>

export const Product: Story = {
  args: { message: message({ kind: 'product', commerce: { type: 'sent', catalog_id: CATALOG_ID, content: { type: 'product', body: 'وصلت دفعة جديدة', footer: 'متجر الأمل', product_retailer_id: 'wv-101' }, products: [{ product_retailer_id: 'wv-101', product: coffee }] } }) },
}
export const ProductList: Story = {
  args: {
    message: message({
      kind: 'product_list',
      commerce: {
        type: 'sent', catalog_id: CATALOG_ID,
        content: { type: 'product_list', header: 'منتجات مختارة', body: 'اختر من منتجاتنا', footer: null, sections: [{ title: 'القهوة', product_retailer_ids: ['wv-101'] }, { title: 'الأدوات', product_retailer_ids: ['wv-102', 'wv-104'] }] },
        products: [{ product_retailer_id: 'wv-101', product: coffee }, { product_retailer_id: 'wv-102', product: pot }, { product_retailer_id: 'wv-104', product: grinder }],
      },
    }),
  },
}
export const CatalogMessage: Story = {
  args: { message: message({ kind: 'catalog_message', commerce: { type: 'sent', catalog_id: CATALOG_ID, content: { type: 'catalog_message', body: 'تصفح كتالوجنا كاملًا', footer: null, thumbnail_product_retailer_id: 'wv-101' }, products: [{ product_retailer_id: 'wv-101', product: coffee }] } }) },
}
export const RemovedProduct: Story = {
  args: { message: message({ kind: 'product', commerce: { type: 'sent', catalog_id: CATALOG_ID, content: { type: 'product', body: null, footer: null, product_retailer_id: 'wv-777' }, products: [{ product_retailer_id: 'wv-777', product: null }] } }) },
}
export const Inquiry: Story = {
  args: { message: message({ direction: 'in', kind: 'text', body: 'هل متوفر بلون آخر؟', author: null, delivery_state: 'received', commerce: { type: 'inquiry', catalog_id: CATALOG_ID, product_retailer_id: 'wv-102', product: pot } }) },
}
export const CartWaiting: Story = { args: { message: cart({ id: 1, state: 'cart', reference: null, payment_status: null }) } }
export const CartWindowClosed: Story = { args: { message: cart({ id: 1, state: 'cart', reference: null, payment_status: null }), windowOpen: false } }
export const CartAwaitingPayment: Story = { args: { message: cart({ id: 1, state: 'ordered', reference: 'S00012', payment_status: 'payable' }) } }
export const CartPaid: Story = { args: { message: cart({ id: 1, state: 'ordered', reference: 'S00012', payment_status: 'paid' }) } }
export const CartDismissed: Story = { args: { message: cart({ id: 1, state: 'dismissed', reference: null, payment_status: null }) } }
export const CartWithoutOrder: Story = { args: { message: cart(null) } }
