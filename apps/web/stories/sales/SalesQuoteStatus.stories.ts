import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesQuoteStatus from '../../app/components/sales/SalesQuoteStatus.vue'
import { storyContext } from '../support/context'
import { publicQuote } from './salesFixtures'

const closed = { can_accept: false, can_decline: false }
const meta = {
  title: 'Sales/SalesQuoteStatus',
  component: SalesQuoteStatus,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/quote/[id].vue:47', 'ما آل إليه عرض السعر عند العميل حين لا يستطيع الرد: قبله أو رفضه، أو أكّده المرسل أو ألغاه، أو انتهت صلاحيته، أو لم يُتح الرد عبر الإنترنت.') },
  args: { quote: { ...publicQuote, ...closed, expired: true } },
} satisfies Meta<typeof SalesQuoteStatus>
export default meta
type Story = StoryObj<typeof meta>

export const Expired: Story = { name: 'منتهي الصلاحية' }
export const Accepted: Story = { name: 'مقبول', args: { quote: { ...publicQuote, ...closed, answer: 'accepted', answered_at: '2026-11-15T10:20:00Z', signed_by: 'منى العتيبي' } } }
export const AcceptedAndConfirmed: Story = { name: 'مقبول والطلب مؤكد', args: { quote: { ...publicQuote, ...closed, state: 'confirmed', answer: 'accepted', answered_at: '2026-11-15T10:20:00Z' } } }
export const Declined: Story = { name: 'مرفوض', args: { quote: { ...publicQuote, ...closed, answer: 'declined', answered_at: '2026-11-15T10:20:00Z' } } }
export const Confirmed: Story = { name: 'أكّده المرسل', args: { quote: { ...publicQuote, ...closed, state: 'confirmed' } } }
export const Cancelled: Story = { name: 'ملغى', args: { quote: { ...publicQuote, ...closed, state: 'cancelled' } } }
export const NotOffered: Story = { name: 'للقراءة فقط', args: { quote: { ...publicQuote, ...closed, answer_mode: 'none' } } }
