import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShiftAssignmentForm from '../../../app/components/hr/shifts/ShiftAssignmentForm.vue'
import { storyContext } from '../../support/context'

// نموذج إسناد وردية: موظف وجدول عمل وفترة (التاريخ الفارغ يعني نهاية مفتوحة).
// يُستخدم من `/hr/shifts/new` داخل لوحة الإنشاء، ويعود إلى القائمة عند الحفظ.
const employees = [
  { value: '2', label: 'سارة العتيبي' },
  { value: '3', label: 'خالد الحربي' },
]
const schedules = [
  { value: '4', label: 'وردية الصباح' },
  { value: '5', label: 'وردية مسائية' },
]

const meta = {
  title: 'HR/ShiftAssignmentForm',
  component: ShiftAssignmentForm,
  parameters: storyContext('apps/web/app/pages/hr/shifts/new.vue:28', 'داخل لوحة الإنشاء `SharedCreatePanel` في `/hr/shifts/new`.'),
  args: { backTo: '/hr/shifts', employees, schedules },
  render: args => ({
    components: { ShiftAssignmentForm },
    setup: () => ({ args }),
    template: '<div class="max-w-2xl"><ShiftAssignmentForm v-bind="args" /></div>',
  }),
} satisfies Meta<typeof ShiftAssignmentForm>
export default meta
type Story = StoryObj<typeof meta>

export const Create: Story = { name: 'إسناد وردية' }

export const NoEmployees: Story = { name: 'لا موظفون بعد', args: { employees: [] } }
