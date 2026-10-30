import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PayrollGeneralSettingsForm from '../../../app/components/hr/payroll/PayrollGeneralSettingsForm.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The general payroll settings: the day divisor, the salary structure (shown, not chosen), the annual leave type and
// the unpaid leave types. It saves only the fields that changed.
const settings = { day_divisor: 30, structure: { id: 1, name: 'هيكل الرواتب السعودي' }, unpaid_leave_types: [{ id: 2, name: 'إجازة بدون راتب' }], annual_leave_type: { id: 1, name: 'إجازة سنوية' }, revision: 2 }
const leaveTypes = [{ id: 1, name: 'إجازة سنوية' }, { id: 2, name: 'إجازة بدون راتب' }, { id: 3, name: 'إجازة مرضية' }]

const meta = {
  title: 'HR/Payroll/PayrollGeneralSettingsForm',
  component: PayrollGeneralSettingsForm,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/settings/apps/hr/index.vue:125', 'نموذج الإعدادات العامة للرواتب: قاسم الأيام، وهيكل الراتب، ونوع الإجازة السنوية، وأنواع الإجازة بدون راتب.'),
  },
  args: {
    settings,
    leaveTypes,
    canEdit: true,
    reloadSettings: async () => settings,
  },
  render: args => ({
    components: { PayrollGeneralSettingsForm, PageContainer },
    setup: () => ({ args }),
    template: '<main class="liwan-shell-main"><PageContainer width="list"><PayrollGeneralSettingsForm v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof PayrollGeneralSettingsForm>

export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'قابل للتعديل' }

export const ReadOnly: Story = { name: 'قراءة فقط', args: { canEdit: false } }
