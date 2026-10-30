import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PayrollPostingPreview from '../../../app/components/hr/payroll/PayrollPostingPreview.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The accounting entry a posting would create, shown inline on the run page before the user confirms: date, journal,
// the server's warnings, the lines and their totals.
const preview = {
  entry_detail: 'aggregated',
  date: '2026-10-31',
  journal: { id: 7, name: 'قيود الرواتب' },
  lines: [
    { account: { id: 1, code: '510101', name: 'مصروف الأجور الأساسية' }, analytic_account: { id: 5, name: 'فرع الرياض' }, employee: null, debit: 28000, credit: 0 },
    { account: { id: 2, code: '510401', name: 'مصروف التأمينات' }, analytic_account: null, employee: null, debit: 3290, credit: 0 },
    { account: { id: 3, code: '210101', name: 'الرواتب المستحقة' }, analytic_account: null, employee: null, debit: 0, credit: 25270 },
    { account: { id: 4, code: '210201', name: 'التأمينات المستحقة' }, analytic_account: null, employee: null, debit: 0, credit: 6020 },
  ],
  debit: 31290,
  credit: 31290,
  warnings: [],
}

const meta = {
  title: 'HR/Payroll/PayrollPostingPreview',
  component: PayrollPostingPreview,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/payroll/[runId]/index.vue:229', 'القيد المقترح داخل صفحة المسير قبل تأكيد الترحيل: التاريخ والدفتر والتنبيهات وأسطر القيد ومجموعه.'),
  },
  args: { preview },
  render: args => ({
    components: { PayrollPostingPreview, PageContainer },
    setup: () => ({ args }),
    template: '<main class="liwan-shell-main"><PageContainer width="full"><PayrollPostingPreview v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof PayrollPostingPreview>

export default meta
type Story = StoryObj<typeof meta>

export const Aggregated: Story = { name: 'قيد مجمّع' }

export const WithWarnings: Story = {
  name: 'مع تنبيه قسم بلا مركز تكلفة',
  args: { preview: { ...preview, warnings: [{ code: 'unmapped_department', employee: { id: 4, name: 'خالد الشمري' } }] } },
}

export const PerEmployee: Story = {
  name: 'قيد لكل موظف',
  args: {
    preview: {
      ...preview,
      entry_detail: 'per_employee',
      lines: [
        { account: { id: 1, code: '510101', name: 'مصروف الأجور الأساسية' }, analytic_account: { id: 5, name: 'فرع الرياض' }, employee: { id: 3, name: 'ليلى الحربي' }, debit: 10500, credit: 0 },
        { account: { id: 3, code: '210101', name: 'الرواتب المستحقة' }, analytic_account: null, employee: { id: 3, name: 'ليلى الحربي' }, debit: 0, credit: 9476.25 },
        { account: { id: 4, code: '210201', name: 'التأمينات المستحقة' }, analytic_account: null, employee: { id: 3, name: 'ليلى الحربي' }, debit: 0, credit: 1023.75 },
      ],
      debit: 10500,
      credit: 10500,
    },
  },
}

export const Empty: Story = { name: 'بلا أسطر', args: { preview: { ...preview, lines: [], debit: 0, credit: 0 } } }
