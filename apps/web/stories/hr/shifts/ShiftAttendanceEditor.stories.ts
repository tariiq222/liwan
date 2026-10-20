import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShiftAttendanceEditor from '../../../app/components/hr/shifts/ShiftAttendanceEditor.vue'
import { storyContext } from '../../support/context'

// محرّر بنود الدوام: يوم وفترة وساعتا البداية والنهاية لكل بند. لا يرسل طلبًا؛
// القيمة تعود إلى النموذج الأعلى عبر `update:modelValue`.
const meta = {
  title: 'HR/ShiftAttendanceEditor',
  component: ShiftAttendanceEditor,
  parameters: storyContext('apps/web/app/components/hr/shifts/ShiftScheduleForm.vue:100', 'داخل قسم «بنود الدوام» في نموذج جدول العمل.'),
  args: {
    modelValue: [
      { dayofweek: '6', day_period: 'morning', hour_from: 8, hour_to: 12, week_type: null },
      { dayofweek: '6', day_period: 'afternoon', hour_from: 13, hour_to: 17, week_type: null },
    ],
    disabled: false,
  },
  render: args => ({
    components: { ShiftAttendanceEditor },
    setup: () => ({ args }),
    template: '<div class="max-w-3xl"><ShiftAttendanceEditor v-bind="args" /></div>',
  }),
} satisfies Meta<typeof ShiftAttendanceEditor>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'بندان في يوم واحد' }

export const SingleLine: Story = {
  name: 'بند واحد',
  args: { modelValue: [{ dayofweek: '6', day_period: 'full_day', hour_from: 8, hour_to: 16, week_type: null }] },
}

export const Disabled: Story = { name: 'معطّل أثناء الحفظ', args: { disabled: true } }
