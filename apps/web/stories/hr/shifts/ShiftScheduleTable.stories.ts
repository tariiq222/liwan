import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShiftScheduleTable from '../../../app/components/hr/shifts/ShiftScheduleTable.vue'
import { storyContext } from '../../support/context'

// جدول جداول العمل في `/hr/shifts/schedules`: الاسم والمنطقة الزمنية وساعات الأسبوع
// وعدد البنود والحالة؛ الصف يفتح صفحة الجدول وللمدير إجراء الأرشفة.
const schedules = [
  {
    id: 4,
    name: 'وردية الصباح',
    tz: 'Asia/Riyadh',
    two_weeks: false,
    hours_per_week: 20,
    active: true,
    attendances: [
      { dayofweek: '0' as const, day_period: 'morning' as const, hour_from: 8, hour_to: 12, week_type: null },
      { dayofweek: '2' as const, day_period: 'afternoon' as const, hour_from: 13, hour_to: 17, week_type: null },
    ],
  },
  {
    id: 5,
    name: 'وردية مسائية مؤرشفة',
    tz: 'UTC',
    two_weeks: false,
    hours_per_week: 16,
    active: false,
    attendances: [
      { dayofweek: '1' as const, day_period: 'afternoon' as const, hour_from: 14, hour_to: 22, week_type: null },
    ],
  },
]

const meta = {
  title: 'HR/ShiftScheduleTable',
  component: ShiftScheduleTable,
  parameters: storyContext('apps/web/app/pages/hr/shifts/schedules.vue:113', 'داخل بطاقة قائمة جداول العمل؛ الأرشفة تعود إلى الصفحة لتأكيدها مضمّنًا.'),
  args: { schedules, caption: 'جداول العمل', loading: false, error: null, canManage: true },
  render: args => ({
    components: { ShiftScheduleTable },
    setup: () => ({ args }),
    template: '<div class="max-w-3xl"><ShiftScheduleTable v-bind="args" /></div>',
  }),
} satisfies Meta<typeof ShiftScheduleTable>
export default meta
type Story = StoryObj<typeof meta>

export const Manager: Story = { name: 'مدير بجدول نشط ومؤرشف' }

export const Reader: Story = { name: 'قارئ بلا إجراءات', args: { canManage: false } }
