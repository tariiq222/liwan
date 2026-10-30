import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PayslipDocument from '../../../app/components/hr/payroll/PayslipDocument.vue'
import StandalonePage from '@liwan/ui/app/components/shared/layout/StandalonePage.vue'
import { storyContext } from '../../support/context'

// One payslip as a printable document: company and employee heading, earnings and deductions, the net and the
// signature lines. It is the content of the print page (black on white on paper).
const payslip = {
  id: 11,
  number: 'SLIP/2026/0011',
  month: '2026-10',
  state: 'done',
  employee: { id: 3, name: 'ليلى الحربي' },
  department: { id: 1, name: 'المالية' },
  paid_days: 30,
  lines: [
    { code: 'BASIC', name: 'الأجر الأساسي', category: 'BASIC', amount: 8000 },
    { code: 'HOUSING', name: 'بدل السكن', category: 'ALW', amount: 2000 },
    { code: 'TRANSPORT', name: 'بدل النقل', category: 'ALW', amount: 500 },
    { code: 'GOSI_EMP', name: 'تأمينات الموظف', category: 'DED', amount: -990 },
  ],
  gross: 10500,
  deductions: 990,
  net: 9510,
  gosi_employer: 1260,
  company: { name: 'شركة النماء للتقنية', vat: '300012345600003' },
  currency: 'SAR',
}

const meta = {
  title: 'HR/Payroll/PayslipDocument',
  component: PayslipDocument,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/payroll/[runId]/payslips/[payslipId].vue:35', 'مستند القسيمة داخل صفحة الطباعة: رأس الشركة والموظف، والمستحقات والخصومات، وصافي الراتب، وخطا التوقيع.'),
  },
  args: { payslip },
  render: args => ({
    components: { PayslipDocument, StandalonePage },
    setup: () => ({ args }),
    template: '<main class="liwan-shell-main"><StandalonePage variant="print"><PayslipDocument v-bind="args" /></StandalonePage></main>',
  }),
} satisfies Meta<typeof PayslipDocument>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'قسيمة راتب' }

export const NoDeductions: Story = { name: 'بلا خصومات', args: { payslip: { ...payslip, lines: payslip.lines.slice(0, 3), deductions: 0, net: 10500 } } }
