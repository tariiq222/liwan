import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CustomerTable from '../../app/components/customers/CustomerTable.vue'
import { storyContext } from '../support/context'
import { customers } from './customerFixtures'

const meta = {
  title: 'Customers/CustomerTable',
  component: CustomerTable,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/customers/CustomerDirectory.vue:56', 'صفوف دليل العملاء: الاسم والشركة الأم والجوال والبريد والفرع المالك (أو «مشترك بين كل الفروع») والحالة. الصفحة تملك الاستعلام والترقيم.'),
  },
  args: { rows: customers, loading: false, error: null, recordTo: customer => `/customers/${customer.id}` },
} satisfies Meta<typeof CustomerTable>
export default meta
type Story = StoryObj<typeof meta>

export const Rows: Story = { name: 'صفوف' }
export const Loading: Story = { name: 'جارٍ التحميل', args: { rows: [], loading: true } }
export const Failed: Story = { name: 'فشل التحميل', args: { rows: [], error: new Error('offline') } }
