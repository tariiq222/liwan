import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import SalesQuoteAnswer from '../../app/components/sales/SalesQuoteAnswer.vue'
import { storyContext } from '../support/context'
import { publicQuote } from './salesFixtures'

const meta = {
  title: 'Sales/SalesQuoteAnswer',
  component: SalesQuoteAnswer,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/quote/[id].vue:53', 'ردّ العميل على عرض سعر مفتوح: قبول بضغطة أو باسم وتوقيع مرسوم، أو رفض بسبب اختياري بعد تأكيد مضمَّن.') },
  args: { quote: publicQuote, pending: null, error: null },
} satisfies Meta<typeof SalesQuoteAnswer>
export default meta
type Story = StoryObj<typeof meta>

export const AcceptOrDecline: Story = { name: 'قبول أو رفض' }
export const AcceptAndSign: Story = { name: 'قبول بتوقيع', args: { quote: { ...publicQuote, answer_mode: 'accept_and_sign' } } }
export const AcceptAndSignDrawOnly: Story = { name: 'قبول بتوقيع مرسوم فقط', args: { quote: { ...publicQuote, answer_mode: 'accept_and_sign', signature_methods: 'draw' } } }
export const AcceptAsksOnce: Story = {
  name: 'القبول يسأل مرة واحدة',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByTestId('quote-accept'))
    await expect(await canvas.findByText('هل تريد قبول عرض السعر؟')).toBeVisible()
    await expect(canvas.queryByTestId('quote-accept')).toBeNull()
  },
}
export const DeclineOnly: Story = { name: 'رفض فقط', args: { quote: { ...publicQuote, can_accept: false } } }
export const Sending: Story = { name: 'جارٍ الإرسال', args: { pending: 'accept' } }
export const Refused: Story = { name: 'رفض الخادم', args: { error: 'سبق الرد على عرض السعر هذا.' } }
