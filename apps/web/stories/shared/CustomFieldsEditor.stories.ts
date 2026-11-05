import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CustomFieldDefinitionPatchItem, CustomFieldLimits, CustomFieldType } from '@liwan/contracts'
import CustomFieldsEditor from '../../app/components/shared/form/CustomFieldsEditor.vue'
import { storyContext } from '../support/context'

const types: CustomFieldType[] = ['char', 'text', 'integer', 'float', 'boolean', 'date', 'datetime', 'selection', 'tags']
const limits: CustomFieldLimits = { max_properties: 50, max_options: 100, max_label: 64 }

// A company definition as the settings endpoint sends it: every field carries its server key, and an option does too.
const fields: CustomFieldDefinitionPatchItem[] = [
  { key: 'sector', label: 'القطاع', type: 'selection', options: [{ key: 'retail', label: 'تجزئة' }, { key: 'services', label: 'خدمات' }, { key: 'education', label: 'تعليم' }] },
  { key: 'city', label: 'المدينة', type: 'char' },
  { key: 'branch_count', label: 'عدد الفروع', type: 'integer' },
  { key: 'interests', label: 'الاهتمامات', type: 'tags', options: [{ key: 'pricing', label: 'الأسعار' }, { key: 'support', label: 'الدعم' }] },
]

const meta = {
  title: 'Shared/CustomFieldsEditor',
  component: CustomFieldsEditor,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext('apps/web/app/components/crm/settings/CrmCustomFieldsCard.vue:21', 'محرر تعريف الحقول المخصصة للشركة: إضافة حقل وتسميته وترتيبه وخياراته، وحذف حقل مع تنبيه أن قيمه تُحذف من كل السجلات.'),
  },
  args: { modelValue: fields, types, limits, disabled: false },
  render: args => ({
    components: { CustomFieldsEditor },
    setup() {
      const value = ref(args.modelValue)
      return { args, value, t: useI18n().t, onChange: (next: CustomFieldDefinitionPatchItem[]) => { value.value = next } }
    },
    template: '<div class="max-w-3xl"><CustomFieldsEditor :model-value="value" :types="args.types" :limits="args.limits" :disabled="args.disabled" @update:model-value="onChange" /></div>',
  }),
} satisfies Meta<typeof CustomFieldsEditor>
export default meta
type Story = StoryObj<typeof meta>

export const CompanyDefinition: Story = { name: 'تعريف الشركة' }
export const NoFields: Story = { name: 'بلا حقول', args: { modelValue: [] } }
export const Disabled: Story = { name: 'معطّل', args: { disabled: true } }
export const AtLimit: Story = { name: 'بلغ الحد الأقصى', args: { limits: { ...limits, max_properties: fields.length } } }
export const OptionsAtLimit: Story = {
  name: 'خيارات بلغت حدها',
  args: {
    modelValue: [{ key: 'channel', label: 'قناة التواصل', type: 'selection', options: [{ key: 'call', label: 'هاتف' }, { key: 'visit', label: 'زيارة' }] }],
    limits: { ...limits, max_options: 2 },
  },
}
