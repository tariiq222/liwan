import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PayrollInputsTable from '../../../app/components/hr/payroll/PayrollInputsTable.vue'
import ListCard from '@liwan/ui/app/components/shared/layout/ListCard.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The payslip register of one run: a row per employee with the five monthly inputs (number cells while the run is
// editable) and the computed figures, and a totals row that prints. Static fixtures, no requests.
const inputs = (overrides: Record<string, number> = {}) => ({
  overtime_amount: 0, absence_days: 0, bonus_amount: 0, deduction_amount: 0, advance_recovery_amount: 0, ...overrides,
})
const rows = [
  { id: 11, employee: { id: 3, name: 'ليلى الحربي' }, department: { id: 1, name: 'المالية' }, state: 'draft', paid_days: 30, inputs: inputs({ bonus_amount: 500 }), gross: 11000, deductions: 990, net: 10010, iban_missing: false },
  { id: 12, employee: { id: 4, name: 'خالد الشمري' }, department: null, state: 'draft', paid_days: 28, inputs: inputs({ absence_days: 2 }), gross: 9200, deductions: 840, net: 8360, iban_missing: true },
  { id: 13, employee: { id: 5, name: 'منى القحطاني' }, department: { id: 2, name: 'الموارد البشرية' }, state: 'draft', paid_days: 30, inputs: inputs({ overtime_amount: 300.5 }), gross: 8300.5, deductions: 760, net: 7540.5, iban_missing: false },
]
const totals = { gross: 28500.5, deductions: 2590, gosi_employee: 2590, gosi_employer: 3400, net: 25910.5 }

const meta = {
  title: 'HR/Payroll/PayrollInputsTable',
  component: PayrollInputsTable,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/payroll/[runId]/index.vue:307', 'كشف الرواتب داخل صفحة المسير: خلايا مدخلات الشهر الخمس قابلة للتعديل قبل الاعتماد، ثم الإجمالي والخصومات والصافي لكل موظف وصف المجاميع.'),
  },
  args: { rows, rowTo: () => '/hr/payroll/5/payslips/11', totals, caption: 'كشف الرواتب', editable: true },
  render: args => ({
    components: { PayrollInputsTable, ListCard, PageContainer },
    setup: () => ({ args }),
    template: '<main class="liwan-shell-main"><PageContainer width="full"><ListCard><PayrollInputsTable v-bind="args" /></ListCard></PageContainer></main>',
  }),
} satisfies Meta<typeof PayrollInputsTable>

export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'مدخلات قابلة للتعديل' }

export const ReadOnly: Story = { name: 'مسير معتمد', args: { editable: false } }

export const Saving: Story = { name: 'حفظ خلية قيد التنفيذ', args: { saving: ['11:bonus_amount'] } }
