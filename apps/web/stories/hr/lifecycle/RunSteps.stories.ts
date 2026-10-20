import type { Meta, StoryObj } from '@storybook/vue3-vite'
import RunSteps from '../../../app/components/hr/lifecycle/RunSteps.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'
import { run } from './fixtures'

const meta = {
  title: 'HR/Lifecycle/RunSteps',
  component: RunSteps,
  parameters: { layout: 'fullscreen' },
  args: { run, namespace: 'hrOnboarding', pending: false },
} satisfies Meta<typeof RunSteps>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  parameters: storyContext('apps/web/app/pages/hr/onboarding/[runId].vue:2'),
  render: args => ({ components: { RunSteps, PageContainer }, setup: () => ({ args }), template: '<main class="webvue-shell-main"><PageContainer width="list"><RunSteps v-bind="args" /></PageContainer></main>' }),
}

export const Finished: Story = { name: 'منجزة', args: { run: { ...run, done: 2, state: 'done', steps: run.steps.map(step => ({ ...step, state: 'done', can_complete: false })) } } }
