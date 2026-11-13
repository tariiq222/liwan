import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import CustomerEraseConfirm from '../../app/components/customers/CustomerEraseConfirm.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Customers/CustomerEraseConfirm',
  component: CustomerEraseConfirm,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/customers/[id]/privacy.vue:113', 'الخطوة الأخيرة لمسح البيانات الشخصية: السبب وكتابة اسم العميل كما هو تمامًا. لا يعمل زر المسح حتى يطابق الاسم، ويعيد الخادم المقارنة. تحت المراجعة مباشرة، لا نافذة.'),
  },
  args: { customerName: 'منى العتيبي', onConfirm: fn(), onCancel: fn() },
} satisfies Meta<typeof CustomerEraseConfirm>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'الحالة العادية' }
export const Sending: Story = { name: 'جارٍ المسح', args: { pending: true } }
export const NameRefused: Story = { name: 'الاسم مرفوض', args: { nameRefused: true } }
export const ReasonRefused: Story = { name: 'السبب مرفوض', args: { reasonRefused: true } }
