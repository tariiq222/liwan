import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ForbiddenState from '@liwan/ui/app/components/shared/feedback/ForbiddenState.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/ForbiddenState',
  component: ForbiddenState,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' }, ...storyContext('packages/ui/app/components/shared/feedback/PageState.vue:19') },
  render: args => ({
    components: { ForbiddenState, PageContainer },
    setup: () => ({ args }),
    template: '<main class="liwan-shell-main"><PageContainer width="detail"><ForbiddenState v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof ForbiddenState>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'بلا صلاحية' }
