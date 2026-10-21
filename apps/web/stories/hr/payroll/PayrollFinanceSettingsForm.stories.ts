import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PayrollFinanceSettingsForm from '../../../app/components/hr/payroll/PayrollFinanceSettingsForm.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The accounting mapping of payroll in the settings: the journal, the entry's level of detail, the default cost center
// and the account of each role. Without the finance read rights a picker shows its value read-only.
const accounts = [
  { id: 11, code: '510101', name: 'مصروف الأجور الأساسية' },
  { id: 12, code: '510201', name: 'مصروف البدلات' },
  { id: 13, code: '210101', name: 'الرواتب المستحقة' },
]
const roles = ['basic_expense', 'allowance_expense', 'variable_expense', 'gosi_expense', 'gosi_payable', 'salaries_payable', 'deduction', 'advance', 'eos_expense', 'eos_provision']
const settings = {
  journal: { id: 7, name: 'قيود الرواتب' },
  accounts: Object.fromEntries(roles.map(role => [role, role === 'basic_expense' ? { id: 11, name: 'مصروف الأجور الأساسية' } : null])),
  default_analytic_account: null,
  entry_detail: 'aggregated',
} as const

const meta = {
  title: 'HR/Payroll/PayrollFinanceSettingsForm',
  component: PayrollFinanceSettingsForm,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/payroll/settings.vue:68', 'قسم ربط الرواتب بالمحاسبة في إعدادات الرواتب: الدفتر ومستوى تفصيل القيد ومركز التكلفة الافتراضي وحساب كل دور.'),
  },
  args: {
    settings,
    canEdit: true,
    truncated: false,
    journals: [{ id: 7, name: 'قيود الرواتب' }, { id: 8, name: 'قيود عامة' }],
    accounts,
    analyticAccounts: [{ id: 5, code: 'BR-RUH', name: 'فرع الرياض' }],
  },
  render: args => ({
    components: { PayrollFinanceSettingsForm, PageContainer },
    setup: () => ({ args }),
    template: '<main class="webvue-shell-main"><PageContainer width="list"><PayrollFinanceSettingsForm v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof PayrollFinanceSettingsForm>

export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'قابل للتعديل' }

export const ReadOnly: Story = { name: 'قراءة فقط', args: { canEdit: false } }

export const LookupsUnavailable: Story = { name: 'بلا صلاحية قراءة القوائم', args: { journals: null, accounts: null, analyticAccounts: null } }

export const Truncated: Story = { name: 'قائمة مختصرة', args: { truncated: true } }
