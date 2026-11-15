import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesQuoteAnswer from '../../app/components/sales/SalesQuoteAnswer.vue'
import { storyContext } from '../support/context'
import { publicQuote } from './salesFixtures'

const meta = {
  title: 'Sales/SalesQuoteAnswer',
  component: SalesQuoteAnswer,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/quote/[id].vue:52', 'ردّ العميل على عرض سعر مفتوح: قبول بضغطة أو باسم وتوقيع مرسوم، أو رفض بسبب اختياري بعد تأكيد مضمَّن.') },
  args: { quote: publicQuote, pending: null, error: null },
} satisfies Meta<typeof SalesQuoteAnswer>
export default meta
type Story = StoryObj<typeof meta>

export const AcceptOrDecline: Story = { name: 'قبول أو رفض' }
export const AcceptAndSign: Story = { name: 'قبول بتوقيع', args: { quote: { ...publicQuote, answer_mode: 'accept_and_sign' } } }
export const DeclineOnly: Story = { name: 'رفض فقط', args: { quote: { ...publicQuote, can_accept: false } } }
export const Sending: Story = { name: 'جارٍ الإرسال', args: { pending: 'accept' } }
export const Refused: Story = { name: 'رفض الخادم', args: { error: 'سبق الرد على عرض السعر هذا.' } }
