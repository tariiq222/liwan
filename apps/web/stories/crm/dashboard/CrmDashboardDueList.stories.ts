import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmDashboardDueList from '../../../app/components/crm/dashboard/CrmDashboardDueList.vue'
import { storyContext } from '../../support/context'
import { opportunities } from './crmDashboardFixtures'

const meta = {
  title: 'CRM/CrmDashboardDueList',
  component: CrmDashboardDueList,
  parameters: storyContext('apps/web/app/pages/crm/index.vue:29', 'مكالمات المسؤول المستحقة الآن، والهاتف رابط tel:.'),
  args: { items: opportunities, total: 2, viewAllTo: '/crm/opportunities?due=1', now: Date.parse('2026-10-28T12:00:00Z') },
} satisfies Meta<typeof CrmDashboardDueList>
export default meta
type Story = StoryObj<typeof meta>
export const Due: Story = {}
export const MoreThanShown: Story = { args: { total: 12 } }
export const Nothing: Story = { args: { items: [], total: 0 } }
