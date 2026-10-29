import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PayrollRunTable from '../../../app/components/hr/payroll/PayrollRunTable.vue'
import ListCard from '@webvue/ui/app/components/shared/layout/ListCard.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'

// The runs table of /hr/payroll: one row per payroll month with its state pill and totals, inside the page's
// SharedListCard. Static fixtures, no requests.
const totals = (net: number) => ({ gross: net + 1800, deductions: 1800, gosi_employee: 1800, gosi_employer: 2400, net })
const runs = [
  { id: 6, month: '2026-11', state: 'draft', employee_count: 12, totals: totals(0), approved_at: null, currency: 'SAR' },
  { id: 5, month: '2026-10', state: 'computed', employee_count: 12, totals: totals(86400), approved_at: null, currency: 'SAR' },
  { id: 4, month: '2026-09', state: 'approved', employee_count: 11, totals: totals(79200), approved_at: '2026-09-28T09:30:00Z', currency: 'SAR' },
  { id: 3, month: '2026-08', state: 'paid', employee_count: 11, totals: totals(78100), approved_at: '2026-08-27T09:30:00Z', currency: 'SAR' },
]

const meta = {
  title: 'HR/Payroll/PayrollRunTable',
  component: PayrollRunTable,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/payroll.vue:141', 'جدول مسيرات الرواتب داخل بطاقة القائمة: الشهر وحالة المسير وعدد الموظفين والإجمالي والخصومات والصافي وتاريخ الاعتماد.'),
  },
  args: { runs, rowTo: () => '/hr/payroll/5', caption: 'الرواتب' },
  render: args => ({
    components: { PayrollRunTable, ListCard, PageContainer },
    setup: () => ({ args }),
    template: '<main class="webvue-shell-main"><PageContainer width="list"><ListCard><PayrollRunTable v-bind="args" /></ListCard></PageContainer></main>',
  }),
} satisfies Meta<typeof PayrollRunTable>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'جدول المسيرات' }

export const Loading: Story = { name: 'أثناء التحميل', args: { runs: [], loading: true } }
