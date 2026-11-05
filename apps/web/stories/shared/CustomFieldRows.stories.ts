import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import type { CustomFieldWithValue } from '@liwan/contracts'
import CustomFieldRows from '../../app/components/shared/data/CustomFieldRows.vue'
import { storyContext } from '../support/context'

// Every type the definition offers, each with a value: the read and edit states differ only in the controls.
const fields: CustomFieldWithValue[] = [
  { key: 'city', label: 'المدينة', type: 'char', value: 'الرياض' },
  { key: 'notes', label: 'ملاحظات', type: 'text', value: 'يفضّل التواصل بعد الظهر' },
  { key: 'branch_count', label: 'عدد الفروع', type: 'integer', value: 4 },
  { key: 'expected_budget', label: 'الميزانية المتوقعة', type: 'float', value: 45000.5 },
  { key: 'decision_maker', label: 'صاحب القرار', type: 'boolean', value: true },
  { key: 'follow_up_on', label: 'موعد المتابعة', type: 'date', value: '2026-11-02' },
  { key: 'last_contact_at', label: 'آخر تواصل', type: 'datetime', value: '2026-10-28T11:30:00Z' },
  { key: 'sector', label: 'القطاع', type: 'selection', value: 'services', options: [{ key: 'retail', label: 'تجزئة' }, { key: 'services', label: 'خدمات' }] },
  { key: 'interests', label: 'الاهتمامات', type: 'tags', value: ['pricing', 'support'], options: [{ key: 'pricing', label: 'الأسعار' }, { key: 'support', label: 'الدعم' }, { key: 'integration', label: 'التكامل' }] },
]

// The same definition on a record nobody has filled yet: the empty value of each type.
const empty: CustomFieldWithValue[] = fields.map(field => ({ ...field, value: field.type === 'tags' ? [] : field.type === 'boolean' ? false : null }))

const meta = {
  title: 'Shared/CustomFieldRows',
  component: CustomFieldRows,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext('unused', 'حقول الشركة المخصصة لسجل واحد داخل `SharedPropertiesPanel`: قراءة لكل الأنواع، وتحرير يرسل فقط المفاتيح المتغيرة.'),
  },
  args: { fields, editable: false },
  render: args => ({
    components: { CustomFieldRows },
    setup: () => ({ args, t: useI18n().t }),
    template: `<div class="max-w-xl"><dl class="divide-y divide-default"><CustomFieldRows :fields="args.fields" :editable="args.editable" :errors="args.errors" /></dl></div>`,
  }),
} satisfies Meta<typeof CustomFieldRows>
export default meta
type Story = StoryObj<typeof meta>

export const Read: Story = { name: 'قراءة' }
export const Empty: Story = { name: 'بلا قيم', args: { fields: empty } }
export const Edit: Story = { name: 'تحرير', args: { editable: true } }
export const EditWithErrors: Story = { name: 'تحرير مع رفض الخادم', args: { editable: true, errors: { city: 'يجب نص من 1 إلى 255 حرفًا', sector: 'اختر أحد خيارات الحقل' } } }
export const LongLabel: Story = {
  name: 'تحرير بعنوان طويل',
  args: {
    editable: true,
    fields: [
      { key: 'contract_type', label: 'نوع العقد المطلوب للعميل في هذه الفرصة وطريقة تجديده السنوي', type: 'selection', value: null, options: [{ key: 'annual', label: 'سنوي' }, { key: 'monthly', label: 'شهري' }] },
    ],
  },
}
