import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesQuotePayment from '../../app/components/sales/SalesQuotePayment.vue'
import { storyContext } from '../support/context'
import { publicPayment } from './salesFixtures'

const meta = {
  title: 'Sales/SalesQuotePayment',
  component: SalesQuotePayment,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/quote/[id].vue:56', 'دفع عرض السعر عند العميل: المبلغ المطلوب ورابط صفحة الدفع، أو التوقيع أولًا، أو دفعة قيد المعالجة، أو مدفوع، أو الدفع غير متاح.') },
  args: { payment: publicPayment },
} satisfies Meta<typeof SalesQuotePayment>
export default meta
type Story = StoryObj<typeof meta>

export const PayPartOfTotal: Story = { name: 'دفع نسبة من الإجمالي' }
export const PayAll: Story = { name: 'دفع كامل الإجمالي', args: { payment: { ...publicPayment, percent: 100, amount: 248.4 } } }
export const SignFirst: Story = { name: 'التوقيع أولًا', args: { payment: { ...publicPayment, state: 'awaiting_signature', pay_url: null } } }
export const Processing: Story = { name: 'الدفعة قيد المعالجة', args: { payment: { ...publicPayment, state: 'processing', pay_url: null } } }
export const Received: Story = { name: 'وصلت الدفعة والطلب لم يتأكد', args: { payment: { ...publicPayment, state: 'received', amount: 0, pay_url: null } } }
export const ReceivedSignFirst: Story = { name: 'وصلت الدفعة والتوقيع هو المتبقي', args: { signFirst: true, payment: { ...publicPayment, state: 'received', amount: 0, pay_url: null } } }
export const NothingToShow: Story = { name: 'لا شيء يُعرض (دفع غير متاح على عرض مؤكد أو مرفوض)', args: { payment: null } }
export const Paid: Story = { name: 'مدفوع', args: { payment: { ...publicPayment, state: 'paid', amount: 0, pay_url: null } } }
export const Unavailable: Story = { name: 'الدفع غير متاح', args: { payment: { ...publicPayment, state: 'unavailable', pay_url: null } } }
