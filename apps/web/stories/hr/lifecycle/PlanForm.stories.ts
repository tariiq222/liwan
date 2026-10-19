import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PlanForm from '../../../app/components/hr/lifecycle/PlanForm.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'
import { plan } from './fixtures'

const meta = {
  title: 'HR/Lifecycle/PlanForm',
  component: PlanForm,
  parameters: { layout: 'fullscreen' },
  args: { area: 'onboarding', namespace: 'hrOnboarding', backTo: '/hr/onboarding/plans' },
} satisfies Meta<typeof PlanForm>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  parameters: storyContext('apps/web/app/pages/hr/onboarding/plans/new.vue:2'),
  render: args => ({ components: { PlanForm, PageContainer }, setup: () => ({ args }), template: '<main class="webvue-shell-main"><PageContainer width="list"><PlanForm v-bind="args" /></PageContainer></main>' }),
}

export const Editing: Story = { name: 'تعديل خطة', args: { plan } }
