import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DepartureTable from '../../../app/components/hr/lifecycle/DepartureTable.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'
import { departure, clearedDeparture, departureTo } from './fixtures'

const meta = {
  title: 'HR/Lifecycle/DepartureTable',
  component: DepartureTable,
  parameters: { layout: 'fullscreen' },
  args: { departures: [departure, clearedDeparture], namespace: 'hrOffboarding', toFor: departureTo },
} satisfies Meta<typeof DepartureTable>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  parameters: storyContext('apps/web/app/pages/hr/offboarding.vue:2'),
  render: args => ({ components: { DepartureTable, PageContainer }, setup: () => ({ args }), template: '<main class="webvue-shell-main"><PageContainer width="list"><DepartureTable v-bind="args" /></PageContainer></main>' }),
}

export const Empty: Story = { name: 'بلا سجلات', args: { departures: [] } }
