import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import InboxOrderCustomerStep from '../../app/components/inbox/InboxOrderCustomerStep.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Inbox/InboxOrderCustomerStep',
  component: InboxOrderCustomerStep,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/inbox/InboxOrderActions.vue:99', 'الخطوة التي يتوقف عندها إنشاء الطلب حين تتطابق عملاء مع جوال جهة الاتصال: يختار الموظف أحدهم أو يطلب عميلًا جديدًا، ثم يُكرَّر الإنشاء بالاختيار.'),
  },
  args: { candidates: [{ id: 41, name: 'منى العتيبي', phone_last4: '0003' }], onChoose: fn(), onCancel: fn() },
} satisfies Meta<typeof InboxOrderCustomerStep>
export default meta
type Story = StoryObj<typeof meta>

export const OneCandidate: Story = {}
export const SeveralCandidates: Story = {
  args: { candidates: [{ id: 41, name: 'منى العتيبي', phone_last4: '0003' }, { id: 42, name: 'منى سعد العتيبي', phone_last4: '0003' }, { id: 43, name: 'مؤسسة العتيبي', phone_last4: null }] },
}
export const Sending: Story = { args: { pending: true } }
