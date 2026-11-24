import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import MoneyField from '@liwan/ui/app/components/shared/form/MoneyField.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/MoneyField',
  component: MoneyField,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext('apps/vendor-admin/app/pages/ai-billing-settings.vue:100', 'حقل مبلغ واحد: الرقم في صندوق `ltr` بلوحة أرقام عشرية، والوحدة (من الخاصية `unit`) بجانب الصندوق لا داخله فلا تتراكب مع الرقم في RTL، وتدخل في اسم الحقل لقارئ الشاشة. التحقق وعلامة الإلزام من `SharedFormField`.'),
  },
  args: { modelValue: '25.00', label: 'أقل مبلغ', unit: 'ر.س', unitLabel: 'ريال سعودي', name: 'minimum', help: 'يجب أن يبلغ كل مبلغ معروض هذا الحد.' },
} satisfies Meta<typeof MoneyField>
export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = args => ({
  components: { MoneyField },
  setup() {
    const value = ref(args.modelValue)
    return { args, value }
  },
  template: `<div class="max-w-xs"><MoneyField v-bind="args" v-model="value" /></div>`,
})

export const Default: Story = { name: 'افتراضي', render }
export const Required: Story = { name: 'مطلوب', args: { required: true }, render }
export const Empty: Story = { name: 'فارغ', args: { modelValue: '', required: true, placeholder: '0.00' }, render }
export const WithError: Story = { name: 'خطأ', args: { required: true, submitted: true, error: 'أدخل أقل مبلغ بالريال؛ يجب ألا يقل أي مبلغ معروض عنه.' }, render }
export const Disabled: Story = { name: 'معطّل', args: { disabled: true }, render }
export const WholeAmount: Story = { name: 'مبلغ صحيح', args: { whole: true, modelValue: '500', label: 'رسوم التهيئة' }, render }
