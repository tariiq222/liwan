import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import CustomerLinkBlock from '../../app/components/customers/CustomerLinkBlock.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Customers/CustomerLinkBlock',
  component: CustomerLinkBlock,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/inbox/InboxContactPanel.vue:120', 'العميل المرتبط بسجل (فرصة أو جهة اتصال)، أو إجراء الربط. عند وجود عملاء بالرقم نفسه تظهر خطوة الاختيار: ربط أحدهم أو إنشاء عميل جديد، ولا دمج صامت.'),
  },
  args: { customer: null, canLink: true, canOpen: true, candidates: null, onLink: fn(), onDismiss: fn() },
} satisfies Meta<typeof CustomerLinkBlock>
export default meta
type Story = StoryObj<typeof meta>

export const Unlinked: Story = { name: 'غير مرتبط' }
export const Linked: Story = { name: 'مرتبط', args: { customer: { id: 41, name: 'منى العتيبي' } } }
export const LinkedNoAccess: Story = { name: 'مرتبط بلا صلاحية فتح العميل', args: { customer: { id: 41, name: 'منى العتيبي' }, canOpen: false } }
export const CannotLink: Story = { name: 'بلا صلاحية الربط', args: { canLink: false } }
export const Candidates: Story = {
  name: 'عملاء بالرقم نفسه',
  args: { candidates: [{ id: 41, name: 'منى العتيبي', phone_last4: '0001' }, { id: 42, name: 'مؤسسة العتيبي', phone_last4: null }] },
}
export const Failed: Story = { name: 'تعذّر الربط', args: { error: 'الفرصة مرتبطة بعميل بالفعل ولا يمكن تغييره من هنا.' } }
