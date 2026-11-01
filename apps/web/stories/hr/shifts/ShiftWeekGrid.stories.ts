import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShiftWeekGrid from '../../../app/components/hr/shifts/ShiftWeekGrid.vue'
import { storyContext } from '../../support/context'

// الجدول الأسبوعي للورديات في `/hr/shifts/roster`: صف لكل موظف وعمود لكل يوم، وللمدير
// اختيار جدول عمل يضبط أسبوع الموظف كله. الموظف يرى أسبوعه فقط في `/account/schedule`.
const DATES = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']
const morning = { id: 4, name: 'وردية الصباح' }
const weekOf = (id: number, name: string, workdays: number[]) => ({
  employee: { id, name },
  days: DATES.map((date, index) => ({
    date,
    schedule: morning,
    shifts: workdays.includes(index) ? [{ hour_from: 8, hour_to: 16.5, day_period: 'full_day' as const }] : [],
  })),
})
const weeks = [weekOf(2, 'سارة العتيبي', [0, 1, 2, 3, 4]), weekOf(3, 'خالد الحربي', [1, 2, 3, 4, 5])]
const schedules = [
  { id: 4, name: 'وردية الصباح', tz: 'Asia/Riyadh', two_weeks: false, hours_per_week: 42.5, active: true, attendances: [] },
  { id: 5, name: 'وردية مسائية', tz: 'Asia/Riyadh', two_weeks: false, hours_per_week: 40, active: true, attendances: [] },
]

const meta = {
  title: 'HR/ShiftWeekGrid',
  component: ShiftWeekGrid,
  parameters: storyContext('apps/web/app/pages/hr/shifts/roster.vue:72', 'داخل بطاقة القائمة في `/hr/shifts/roster`؛ المدير يرى قائمة ضبط الأسبوع.'),
  args: { weeks, caption: 'جدول الورديات الأسبوعي', schedules, pendingEmployeeId: null },
  render: args => ({
    components: { ShiftWeekGrid },
    setup: () => ({ args }),
    template: '<div class="max-w-5xl"><ShiftWeekGrid v-bind="args" /></div>',
  }),
} satisfies Meta<typeof ShiftWeekGrid>
export default meta
type Story = StoryObj<typeof meta>

export const Manager: Story = { name: 'مدير الورديات' }

export const Reader: Story = { name: 'قارئ بلا ضبط', args: { schedules: undefined } }

export const OwnWeek: Story = { name: 'أسبوعي', args: { weeks: [weeks[0]!], schedules: undefined, showEmployee: false } }
