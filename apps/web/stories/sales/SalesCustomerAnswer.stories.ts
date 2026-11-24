import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesCustomerAnswer from '../../app/components/sales/SalesCustomerAnswer.vue'
import { storyContext } from '../support/context'
import { acceptedAnswer, declinedAnswer, waitingAnswer } from './salesFixtures'

const meta = {
  title: 'Sales/SalesCustomerAnswer',
  component: SalesCustomerAnswer,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/sales/[id].vue:181', 'رد العميل على عرض السعر المُرسَل: بانتظار الرد، أو قبول باسم الموقّع ووقته، أو رفض بسببه.') },
  args: { answer: waitingAnswer },
} satisfies Meta<typeof SalesCustomerAnswer>
export default meta
type Story = StoryObj<typeof meta>

export const Waiting: Story = { name: 'بانتظار العميل' }
export const WaitingConfirmsOrder: Story = { name: 'بانتظار العميل والقبول يؤكد الطلب', args: { answer: { ...waitingAnswer, mode: 'accept', acceptance_confirms: true } } }
export const Accepted: Story = { name: 'قبول موقَّع', args: { answer: acceptedAnswer } }
export const AcceptedTyped: Story = { name: 'قبول موقَّع بكتابة الاسم', args: { answer: { ...acceptedAnswer, signature_method: 'typed' } } }
export const Declined: Story = { name: 'رفض بسبب', args: { answer: declinedAnswer } }
export const DeclinedWithoutReason: Story = { name: 'رفض بلا سبب', args: { answer: { ...declinedAnswer, decline_reason: null } } }
