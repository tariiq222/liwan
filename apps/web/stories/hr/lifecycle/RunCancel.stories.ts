import type { Meta, StoryObj } from '@storybook/vue3-vite'
import RunCancel from '../../../app/components/hr/lifecycle/RunCancel.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../../support/context'
import { run } from './fixtures'

const meta = {
  title: 'HR/Lifecycle/RunCancel',
  component: RunCancel,
  parameters: { layout: 'fullscreen' },
  args: { run, namespace: 'hrOnboarding', pending: false },
  render: args => ({ components: { RunCancel, PageContainer }, setup: () => ({ args }), template: '<main class="webvue-shell-main"><PageContainer width="list"><RunCancel v-bind="args" /></PageContainer></main>' }),
} satisfies Meta<typeof RunCancel>
export default meta
type Story = StoryObj<typeof meta>

export const Cancellable: Story = {
  name: 'قابلة للإلغاء',
  parameters: storyContext('apps/web/app/pages/hr/onboarding/[runId].vue:56'),
}

export const Cancelled: Story = {
  name: 'ملغاة',
  parameters: storyContext('apps/web/app/pages/hr/offboarding/[employeeId].vue:134'),
  args: {
    namespace: 'hrOffboarding',
    run: { ...run, state: 'cancelled', can_cancel: false, cancellation: { by: { id: 7, name: 'Huda' }, on: '2026-10-28T09:30:00Z', reason: 'أُطلقت الخطة لموظف آخر بالخطأ' } },
  },
}
