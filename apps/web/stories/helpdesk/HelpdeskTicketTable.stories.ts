import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { HelpdeskTicketRow } from '@liwan/contracts'
import HelpdeskTicketTable from '../../app/components/helpdesk/HelpdeskTicketTable.vue'
import { storyContext } from '../support/context'
import { tickets } from './helpdeskFixtures'

const meta = {
  title: 'Helpdesk/HelpdeskTicketTable',
  component: HelpdeskTicketTable,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/components/helpdesk/HelpdeskTicketDirectory.vue:89', 'صفوف الدعم: الرقم والموضوع ومقدّم الطلب والمرحلة والأولوية والمسند إليه واتفاقية الخدمة وتاريخ الفتح، مع صف جوال.'),
  },
  args: { rows: tickets, loading: false, error: null, recordTo: (ticket: HelpdeskTicketRow) => ({ path: `/helpdesk/${ticket.id}`, query: { returnTo: '/helpdesk' } }) },
} satisfies Meta<typeof HelpdeskTicketTable>
export default meta
type Story = StoryObj<typeof meta>

export const Rows: Story = { name: 'صفوف' }
export const Loading: Story = { name: 'تحميل', args: { rows: [], loading: true } }
export const NoRows: Story = { name: 'بلا صفوف', args: { rows: [] } }
export const Failed: Story = { name: 'فشل التحميل', args: { rows: [], error: { status: 503 } } }
