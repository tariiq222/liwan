import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShiftAssignmentTable from '../../../app/components/hr/shifts/ShiftAssignmentTable.vue'
import { storyContext } from '../../support/context'

// جدول إسنادات الورديات في `/hr/shifts`: الموظف وجدول العمل والفترة، وللمدير إجراء
// إزالة الإسناد الذي تعرضه الصفحة بتأكيد مضمّن.
const assignments = [
  {
    id: 12,
    employee: { id: 2, name: 'سارة العتيبي' },
    schedule: { id: 4, name: 'وردية الصباح' },
    date_start: '2026-11-01',
    date_end: '2026-11-30',
  },
  {
    id: 13,
    employee: { id: 3, name: 'خالد الحربي' },
    schedule: { id: 5, name: 'وردية مسائية' },
    date_start: '2026-12-01',
    date_end: null,
  },
]

const meta = {
  title: 'HR/ShiftAssignmentTable',
  component: ShiftAssignmentTable,
  parameters: storyContext('apps/web/app/pages/hr/shifts.vue:218', 'داخل بطاقة القائمة في `/hr/shifts`؛ المدير يرى إجراء الإزالة.'),
  args: { assignments, caption: 'الورديات', loading: false, error: null, canManage: true },
  render: args => ({
    components: { ShiftAssignmentTable },
    setup: () => ({ args }),
    template: '<div class="max-w-3xl"><ShiftAssignmentTable v-bind="args" /></div>',
  }),
} satisfies Meta<typeof ShiftAssignmentTable>
export default meta
type Story = StoryObj<typeof meta>

export const Manager: Story = { name: 'مدير الورديات' }

export const Reader: Story = { name: 'قارئ بلا إجراءات', args: { canManage: false } }

export const Loading: Story = { name: 'أثناء التحميل', args: { assignments: [], loading: true } }
