import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SalesOrderTable from '../../app/components/sales/SalesOrderTable.vue'
import { storyContext } from '../support/context'
import { orders } from './salesFixtures'

const meta = {
  title: 'Sales/SalesOrderTable',
  component: SalesOrderTable,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/components/sales/SalesOrderDirectory.vue:66', 'صفوف المبيعات: الرقم والعميل والمندوب والتاريخ والحالة والمصدر والإجمالي.') },
  args: { rows: orders, loading: false, error: null, recordTo: order => `/sales/${order.id}` },
} satisfies Meta<typeof SalesOrderTable>
export default meta
type Story = StoryObj<typeof meta>

export const Rows: Story = { name: 'صفوف' }
export const Loading: Story = { name: 'تحميل', args: { rows: [], loading: true } }
