import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WarningStandingNote from '../../../app/components/hr/warnings/WarningStandingNote.vue'
import { storyContext } from '../../support/context'

// The escalation figure shown to issuers: active warnings inside the company window and the counting rule.
const meta = {
  title: 'HR/Warnings/WarningStandingNote',
  component: WarningStandingNote,
  parameters: storyContext('apps/web/app/components/hr/warnings/WarningForm.vue:88', 'تحت حقل الموظف في نموذج الإنذار، وفوق تفاصيل سجل الإنذار.'),
  args: { standing: { employee_id: 7, window_months: 12, active_count: 2, highest_severity: 2 } },
} satisfies Meta<typeof WarningStandingNote>

export default meta
type Story = StoryObj<typeof meta>

export const TwoActive: Story = { name: 'إنذاران فعّالان' }
export const None: Story = { name: 'لا إنذارات فعّالة', args: { standing: { employee_id: 7, window_months: 12, active_count: 0, highest_severity: null } } }
