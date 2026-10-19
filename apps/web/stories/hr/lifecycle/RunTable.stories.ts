import type { Meta, StoryObj } from '@storybook/vue3-vite'
import RunTable from '../../../app/components/hr/lifecycle/RunTable.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'
import { run, runTo } from './fixtures'

const meta = {
  title: 'HR/Lifecycle/RunTable',
  component: RunTable,
  parameters: { layout: 'fullscreen' },
  args: { runs: [run], namespace: 'hrOnboarding', toFor: runTo },
} satisfies Meta<typeof RunTable>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  parameters: storyContext('apps/web/app/pages/hr/onboarding.vue:2'),
  render: args => ({ components: { RunTable, PageContainer }, setup: () => ({ args }), template: '<main class="webvue-shell-main"><PageContainer width="list"><RunTable v-bind="args" /></PageContainer></main>' }),
}

export const Empty: Story = { name: 'بلا عمليات', args: { runs: [] } }
