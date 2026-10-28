import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmDashboardAgentTable from '../../../app/components/crm/dashboard/CrmDashboardAgentTable.vue'
import { storyContext } from '../../support/context'
import { agentsBlock } from './crmDashboardFixtures'

const meta = {
  title: 'CRM/CrmDashboardAgentTable',
  component: CrmDashboardAgentTable,
  parameters: storyContext('apps/web/app/pages/crm/index.vue:35', 'جدول المسؤولين: المفتوح والمستحق والمباع لكل مسؤول.'),
  args: { agents: agentsBlock },
} satisfies Meta<typeof CrmDashboardAgentTable>
export default meta
type Story = StoryObj<typeof meta>
export const Agents: Story = {}
export const Empty: Story = { args: { agents: [] } }
