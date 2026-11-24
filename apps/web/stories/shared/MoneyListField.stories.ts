import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import MoneyListField from '@liwan/ui/app/components/shared/form/MoneyListField.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/MoneyListField',
  component: MoneyListField,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext('apps/vendor-admin/app/pages/ai-billing-settings.vue:82', 'قائمة مبالغ بمبلغ واحد في كل سطر: كل سطر `SharedMoneyField` بتسميته وخطئه، وإضافة وإزالة بزرّين بأيقونة ونص، والسطر الجديد يأخذ التركيز، ولا تنقص القائمة عن `min` سطر. خطأ القائمة (العدد والترتيب) منفصل عن خطأ كل سطر.'),
  },
  args: {
    modelValue: ['25.00', '50.00', '100.00'],
    label: 'مبالغ الشحن',
    help: 'مبلغ في كل سطر، من الأصغر إلى الأكبر وبلا تكرار. حتى 12 مبلغًا.',
    unit: 'ر.س',
    unitLabel: 'ريال سعودي',
    rowLabel: 'المبلغ',
    addLabel: 'إضافة مبلغ',
    removeLabel: 'إزالة',
    name: 'amounts',
    required: true,
    max: 12,
  },
} satisfies Meta<typeof MoneyListField>
export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = args => ({
  components: { MoneyListField },
  setup() {
    const rows = ref([...args.modelValue])
    return { args, rows }
  },
  template: `<div class="max-w-md"><MoneyListField v-bind="args" v-model="rows" /></div>`,
})

export const Default: Story = { name: 'افتراضي', render }
export const Empty: Story = { name: 'فارغ (سطر واحد)', args: { modelValue: [''] }, render }
export const RowErrors: Story = {
  name: 'أخطاء الأسطر',
  args: { modelValue: ['25.00', '', 'x'], submitted: true, errors: [undefined, 'أدخل مبلغًا بالريال بخانتين عشريتين على الأكثر.', 'أدخل مبلغًا بالريال بخانتين عشريتين على الأكثر.'] },
  render,
}
export const ListError: Story = { name: 'خطأ القائمة', args: { modelValue: ['50.00', '25.00'], submitted: true, error: 'رتّب المبالغ من الأصغر إلى الأكبر بلا تكرار.' }, render }
export const AtMaximum: Story = { name: 'بلغت الحد الأعلى', args: { modelValue: ['25.00', '50.00'], max: 2 }, render }
export const Disabled: Story = { name: 'معطّل', args: { disabled: true }, render }
