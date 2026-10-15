import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import ErrorState from '../../app/components/shared/feedback/ErrorState.vue'
import PageContainer from '../../app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/ErrorState',
  component: ErrorState,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/shared/feedback/PageState.vue:21') },
  args: { error: { status: 500 }, onRetry: fn() },
  render: args => ({
    components: { ErrorState, PageContainer },
    setup: () => ({ args }),
    template: '<main class="nasq-shell-main"><PageContainer width="list"><ErrorState v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof ErrorState>
export default meta
type Story = StoryObj<typeof meta>

export const Generic: Story = { name: 'خطأ عام' }
export const Conflict: Story = { name: 'تعارض 409', args: { error: { status: 409 } } }
