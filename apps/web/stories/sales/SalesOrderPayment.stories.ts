import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesOrderPayment from '../../app/components/sales/SalesOrderPayment.vue'
import { storyContext } from '../support/context'
import { orderPayment } from './salesFixtures'

const received = { amount_received: 99.36, amount_due: 0 }
const meta = {
  title: 'Sales/SalesOrderPayment',
  component: SalesOrderPayment,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/sales/[id].vue:175', 'دفع عرض السعر في صفحة السجل: كيف يطلب الدفع، والمطلوب والمستلم والمتبقي، وحالة رابط الدفع، وسبب بقاء الطلب غير مؤكد رغم وصول الدفعة.') },
  args: { payment: orderPayment },
} satisfies Meta<typeof SalesOrderPayment>
export default meta
type Story = StoryObj<typeof meta>

export const Waiting: Story = { name: 'بانتظار الدفع' }
export const SignFirst: Story = { name: 'العميل يوقّع أولًا', args: { payment: { ...orderPayment, link: 'awaiting_signature', status: 'not_payable' } } }
export const Paid: Story = { name: 'مدفوع', args: { payment: { ...orderPayment, ...received, status: 'paid', link: 'none' } } }
export const HeldAfterExpiry: Story = { name: 'وصلت الدفعة بعد انتهاء الصلاحية', args: { payment: { ...orderPayment, ...received, held: 'expired' } } }
export const HeldAwaitingSignature: Story = { name: 'وصلت الدفعة والتوقيع ناقص', args: { payment: { ...orderPayment, ...received, held: 'awaiting_signature', link: 'awaiting_signature' } } }
export const RefundDue: Story = { name: 'مبلغ مطلوب رده', args: { payment: { ...orderPayment, ...received, status: 'cancelled', link: 'none', amount_to_refund: 99.36 } } }
export const ReceivedThenSwitchedOff: Story = { name: 'وصلت دفعة ثم أُلغي طلب الدفع', args: { payment: { ...orderPayment, ...received, mode: 'off', percent: 100, status: 'none', link: 'none', amount_required: 0, amount_to_refund: 99.36 } } }
export const NoGateway: Story = { name: 'لا توجد بوابة دفع جاهزة', args: { payment: { ...orderPayment, link: 'no_gateway' } } }
export const HeldAfterCancel: Story = { name: 'وصلت الدفعة والعرض ملغي', args: { payment: { ...orderPayment, ...received, status: 'cancelled', held: 'cancelled', link: 'none', amount_to_refund: 99.36, amount_refundable: 99.36, can_refund: true } } }
export const NeedsAttention: Story = { name: 'دفعة تحتاج متابعة', args: { payment: { ...orderPayment, needs_attention: true, attention: 'payment_not_recorded' } } }
export const AwaitsConfirmation: Story = { name: 'وصل المبلغ والعرض ينتظر التأكيد', args: { payment: { ...orderPayment, ...received, status: 'paid', link: 'none', needs_attention: true, attention: 'payment_awaits_confirmation' } } }
export const PaymentReversed: Story = { name: 'دفعة أُلغيت بعد التأكيد', args: { payment: { ...orderPayment, ...received, status: 'paid', link: 'none', amount_due: 99.36, needs_attention: true, attention: 'payment_reversed' } } }
export const All: Story = { name: 'كامل الإجمالي', args: { payment: { ...orderPayment, mode: 'full', percent: 100, amount_required: 248.4, amount_due: 248.4 } } }
