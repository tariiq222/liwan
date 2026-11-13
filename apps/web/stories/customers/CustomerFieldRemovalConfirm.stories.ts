import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import CustomerFieldRemovalConfirm from '../../app/components/customers/settings/CustomerFieldRemovalConfirm.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Customers/CustomerFieldRemovalConfirm',
  component: CustomerFieldRemovalConfirm,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/customers/settings/CustomerFieldsCard.vue:21', 'التأكيد قبل حذف حقول عملاء ما زالت لها قيم: يسمّي كل حقل وعدد القيم التي ستُحذف، ولا يُكرَّر الحفظ إلا بعد التأكيد.'),
  },
  args: { fields: [{ key: 'city', label: 'المدينة', count: 12 }], onConfirm: fn(), onCancel: fn() },
} satisfies Meta<typeof CustomerFieldRemovalConfirm>
export default meta
type Story = StoryObj<typeof meta>

export const OneField: Story = { name: 'حقل واحد' }
export const SeveralFields: Story = {
  name: 'عدة حقول',
  args: { fields: [{ key: 'city', label: 'المدينة', count: 1 }, { key: 'vip', label: 'عميل مميز', count: 2 }, { key: 'tier', label: 'الفئة', count: 340 }] },
}
export const Removing: Story = { name: 'جارٍ الحذف', args: { pending: true } }
