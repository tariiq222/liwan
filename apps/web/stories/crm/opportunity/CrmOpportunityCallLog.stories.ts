import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CrmOpportunityCallLog from '../../../app/components/crm/opportunity/CrmOpportunityCallLog.vue'
import { storyContext } from '../../support/context'
import { calls } from './crmOpportunityFixtures'

const meta = {
  title: 'CRM/CrmOpportunityCallLog',
  component: CrmOpportunityCallLog,
  parameters: storyContext('apps/web/app/pages/crm/opportunities/[id].vue:166', 'سجل الاتصالات على الفرصة، الأحدث أولًا.'),
  args: { calls },
} satisfies Meta<typeof CrmOpportunityCallLog>
export default meta
type Story = StoryObj<typeof meta>
export const WithCalls: Story = {}
export const Empty: Story = { args: { calls: [] } }
