import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PlanTable from '../../../app/components/hr/lifecycle/PlanTable.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'
import { plan, inactivePlan, planTo } from './fixtures'

const meta = {
  title: 'HR/Lifecycle/PlanTable',
  component: PlanTable,
  parameters: { layout: 'fullscreen' },
  args: { plans: [plan, inactivePlan], namespace: 'hrOnboarding', toFor: planTo, canManage: true },
} satisfies Meta<typeof PlanTable>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  parameters: storyContext('apps/web/app/pages/hr/onboarding/plans/index.vue:2'),
  render: args => ({ components: { PlanTable, PageContainer }, setup: () => ({ args }), template: '<main class="webvue-shell-main"><PageContainer width="list"><PlanTable v-bind="args" /></PageContainer></main>' }),
}

export const ReadOnly: Story = { name: 'للقراءة فقط', args: { canManage: false } }
export const Empty: Story = { name: 'بلا خطط', args: { plans: [] } }
