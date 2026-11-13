import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PaymentSuspendedBanner from '../../app/components/shell/PaymentSuspendedBanner.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/PaymentSuspendedBanner',
  component: PaymentSuspendedBanner,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/layouts/default.vue:78', 'الشريط الدائم لكل مستخدم عندما يكون الاشتراك موقوفًا لعدم السداد؛ مساحة العمل للقراءة فقط.'),
  },
  args: { canPay: true },
} satisfies Meta<typeof PaymentSuspendedBanner>

export default meta
type Story = StoryObj<typeof meta>
export const SubscriptionManager: Story = { name: 'مسؤول الاشتراك مع زر الدفع' }
export const OtherUser: Story = { name: 'مستخدم آخر بدون زر', args: { canPay: false } }
