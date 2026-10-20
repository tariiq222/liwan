import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShiftScheduleForm from '../../../app/components/hr/shifts/ShiftScheduleForm.vue'
import { storyContext } from '../../support/context'

// نموذج جدول العمل: الاسم والمنطقة الزمنية وبنود الدوام. ينشئ من `/hr/shifts/schedules/new`
// ويعدّل من صفحة الجدول؛ الحفظ يعود إلى الصفحة التي استدعته.
const schedule = {
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
}

const meta = {
  title: 'HR/ShiftScheduleForm',
  component: ShiftScheduleForm,
  parameters: storyContext('apps/web/app/pages/hr/shifts/schedules/new.vue:19', 'داخل لوحة الإنشاء `SharedCreatePanel`؛ القيمة نفسها تُعدّل الجدول من صفحته.'),
  args: { schedule: null, backTo: '/hr/shifts/schedules' },
  render: args => ({
    components: { ShiftScheduleForm },
    setup: () => ({ args }),
    template: '<div class="max-w-2xl"><ShiftScheduleForm v-bind="args" /></div>',
  }),
} satisfies Meta<typeof ShiftScheduleForm>
export default meta
type Story = StoryObj<typeof meta>

export const Create: Story = { name: 'جدول جديد' }

export const Edit: Story = { name: 'تعديل جدول', args: { schedule } }
