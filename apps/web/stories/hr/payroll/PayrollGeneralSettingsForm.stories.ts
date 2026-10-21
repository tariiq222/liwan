import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PayrollGeneralSettingsForm from '../../../app/components/hr/payroll/PayrollGeneralSettingsForm.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The general payroll settings: the day divisor, the salary structure (shown, not chosen), the annual leave type and
// the unpaid leave types. It saves only the fields that changed.
const leaveTypes = [{ id: 1, name: 'إجازة سنوية' }, { id: 2, name: 'إجازة بدون راتب' }, { id: 3, name: 'إجازة مرضية' }]

const meta = {
  title: 'HR/Payroll/PayrollGeneralSettingsForm',
  component: PayrollGeneralSettingsForm,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/payroll/settings.vue:64', 'نموذج الإعدادات العامة للرواتب: قاسم الأيام، وهيكل الراتب، ونوع الإجازة السنوية، وأنواع الإجازة بدون راتب.'),
  },
  args: {
    settings: { day_divisor: 30, structure: { id: 1, name: 'هيكل الرواتب السعودي' }, unpaid_leave_types: [{ id: 2, name: 'إجازة بدون راتب' }], annual_leave_type: { id: 1, name: 'إجازة سنوية' } },
    leaveTypes,
    canEdit: true,
  },
  render: args => ({
    components: { PayrollGeneralSettingsForm, PageContainer },
    setup: () => ({ args }),
    template: '<main class="webvue-shell-main"><PageContainer width="list"><PayrollGeneralSettingsForm v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof PayrollGeneralSettingsForm>

export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'قابل للتعديل' }

export const ReadOnly: Story = { name: 'قراءة فقط', args: { canEdit: false } }
