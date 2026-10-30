import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DepartureForm from '../../../app/components/hr/lifecycle/DepartureForm.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'
import { departure } from './fixtures'

const meta = {
  title: 'HR/Lifecycle/DepartureForm',
  component: DepartureForm,
  parameters: { layout: 'fullscreen' },
  args: { namespace: 'hrOffboarding', backTo: '/hr/offboarding' },
} satisfies Meta<typeof DepartureForm>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  parameters: storyContext('apps/web/app/pages/hr/offboarding/new.vue:2'),
  render: args => ({ components: { DepartureForm, PageContainer }, setup: () => ({ args }), template: '<main class="liwan-shell-main"><PageContainer width="list"><DepartureForm v-bind="args" /></PageContainer></main>' }),
}

export const Editing: Story = { name: 'تعديل سجل', args: { departure } }
