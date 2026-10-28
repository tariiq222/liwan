import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmOpportunityBoard from '../../../app/components/crm/opportunity/CrmOpportunityBoard.vue'
import { storyContext } from '../../support/context'
import { opportunities, stages } from './crmOpportunityFixtures'

const meta = {
  title: 'CRM/CrmOpportunityBoard',
  component: CrmOpportunityBoard,
  parameters: storyContext('apps/web/app/components/crm/opportunity/CrmOpportunityList.vue:88', 'مراحل المسار أعمدة، والبطاقة تفتح الفرصة.'),
  args: { stages, items: opportunities, to: (item) => `/crm/opportunities/${item.id}`, now: Date.parse('2026-10-29T10:00:00Z') },
} satisfies Meta<typeof CrmOpportunityBoard>
export default meta
type Story = StoryObj<typeof meta>
export const Pipeline: Story = {}
export const Empty: Story = { args: { items: [] } }
