import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import CustomerConflictStep from '../../app/components/customers/CustomerConflictStep.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Customers/CustomerConflictStep',
  component: CustomerConflictStep,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/customers/CustomerForm.vue:149', 'الخطوة التي يتوقف عندها إنشاء العميل حين يوجد عملاء بالرقم نفسه: يفتح الموظف أحدهم أو ينشئ عميلًا جديدًا، ثم يُكرَّر الإنشاء بالاختيار. يظهر الاسم وآخر أربعة أرقام فقط.'),
  },
  args: { candidates: [{ id: 41, name: 'منى العتيبي', phone_last4: '0001' }], onOpen: fn(), onCreateNew: fn(), onCancel: fn() },
} satisfies Meta<typeof CustomerConflictStep>
export default meta
type Story = StoryObj<typeof meta>

export const OneCandidate: Story = { name: 'عميل واحد' }
export const SeveralCandidates: Story = {
  name: 'عدة عملاء',
  args: { candidates: [{ id: 41, name: 'منى العتيبي', phone_last4: '0001' }, { id: 42, name: 'منى سعد العتيبي', phone_last4: '0001' }, { id: 43, name: 'مؤسسة العتيبي', phone_last4: null }] },
}
export const Sending: Story = { name: 'جارٍ الإرسال', args: { pending: true } }
