import type { Meta, StoryObj } from '@storybook/vue3-vite'
import GosiStatementTable from '../../../app/components/hr/payroll/GosiStatementTable.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The GOSI statement of a fixed run: the capped contributory wage and the employee and employer share of each branch,
// with a totals row that prints.
const side = (employee: number, employer: number) => ({ employee, employer })
const statement = {
  month: '2026-10',
  lines: [
    { employee: { id: 3, name: 'ليلى الحربي' }, gosi_number: '123456789', nationality_class: 'saudi_from_2024', contributory_wage: 10000, branches: { annuities: side(950, 1150), saned: side(75, 75), hazards: side(0, 200) }, employee_amount: 1025, employer_amount: 1425 },
    { employee: { id: 4, name: 'خالد الشمري' }, gosi_number: '', nationality_class: 'non_saudi', contributory_wage: 6000, branches: { annuities: side(0, 0), saned: side(0, 0), hazards: side(0, 120) }, employee_amount: 0, employer_amount: 120 },
  ],
  totals: { contributory_wage: 16000, employee_amount: 1025, employer_amount: 1545 },
}

const meta = {
  title: 'HR/Payroll/GosiStatementTable',
  component: GosiStatementTable,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/payroll/[runId]/gosi.vue:42', 'كشف التأمينات الاجتماعية لمسير معتمد: صف لكل موظف بالأجر الخاضع للاشتراك وحصتي الموظف وصاحب العمل لكل فرع، وصف إجماليات يُطبع.'),
  },
  args: { statement, caption: 'كشف التأمينات الاجتماعية' },
  render: args => ({
    components: { GosiStatementTable, PageContainer },
    setup: () => ({ args }),
    template: '<main class="liwan-shell-main"><PageContainer width="full"><GosiStatementTable v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof GosiStatementTable>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'كشف شهري' }
