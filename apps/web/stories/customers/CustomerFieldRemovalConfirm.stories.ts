import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import CustomerFieldRemovalConfirm from '../../app/components/customers/settings/CustomerFieldRemovalConfirm.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Customers/CustomerFieldRemovalConfirm',
  component: CustomerFieldRemovalConfirm,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/customers/settings/CustomerFieldsCard.vue:21', 'التأكيد قبل حذف حقول عملاء أو خيارات منها ما زال العملاء يحملونها: يسمّي كل حقل وكل خيار وعدد ما سيُحذف، وتتغير صياغته بحسب ما يُحذف (حقول أو خيارات أو الاثنان)، ولا يُكرَّر الحفظ إلا بعد التأكيد.'),
  },
  args: { removal: { fields: [{ key: 'city', label: 'المدينة', count: 12 }], options: [] }, onConfirm: fn(), onCancel: fn() },
} satisfies Meta<typeof CustomerFieldRemovalConfirm>
export default meta
type Story = StoryObj<typeof meta>

export const OneField: Story = { name: 'حقل واحد' }
export const SeveralFields: Story = {
  name: 'عدة حقول',
  args: { removal: { fields: [{ key: 'city', label: 'المدينة', count: 1 }, { key: 'vip', label: 'عميل مميز', count: 2 }, { key: 'tier', label: 'الفئة', count: 340 }], options: [] } },
}
export const OptionsOnly: Story = {
  name: 'خيارات فقط',
  args: { removal: { fields: [], options: [{ field_key: 'tier', field_label: 'الفئة', key: 'gold', label: 'ذهبي', count: 3 }, { field_key: 'tier', field_label: 'الفئة', key: 'silver', label: 'فضي', count: 1 }] } },
}
export const FieldsAndOptions: Story = {
  name: 'حقول وخيارات',
  args: { removal: { fields: [{ key: 'city', label: 'المدينة', count: 12 }], options: [{ field_key: 'tier', field_label: 'الفئة', key: 'gold', label: 'ذهبي', count: 2 }] } },
}
export const Removing: Story = { name: 'جارٍ الحذف', args: { pending: true } }
