import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesReportBreakdown from '../../app/components/sales/SalesReportBreakdown.vue'
import { storyContext } from '../support/context'
import { customerBreakdown, customerReportState, defaultReportState, periodBreakdown, productBreakdown, productReportState, salespersonBreakdown } from './salesReportFixtures'

const meta = {
  title: 'Sales/SalesReportBreakdown',
  component: SalesReportBreakdown,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/sales/reports.vue:50', 'مجموعات تقرير المبيعات: الفترة أو المندوب أو العميل أو المنتج، بالطلبات والمبالغ بعملة الشركة.') },
  args: { state: customerReportState, report: customerBreakdown, loading: false, error: null },
} satisfies Meta<typeof SalesReportBreakdown>
export default meta
type Story = StoryObj<typeof meta>

export const ByCustomer: Story = { name: 'حسب العميل' }
export const ByProduct: Story = { name: 'حسب المنتج مع الكمية', args: { state: productReportState, report: productBreakdown } }
export const ByPeriod: Story = { name: 'حسب الفترة', args: { state: defaultReportState, report: periodBreakdown } }
export const BySalesperson: Story = { name: 'حسب المندوب مع طلبات المتجر', args: { state: { ...customerReportState, by: 'salesperson' }, report: salespersonBreakdown } }
export const Empty: Story = { name: 'فارغ', args: { report: { ...customerBreakdown, items: [], total: 0 } } }
export const Loading: Story = { name: 'تحميل', args: { report: undefined, loading: true } }
export const Failed: Story = { name: 'فشل', args: { report: undefined, error: new Error('failed') } }
