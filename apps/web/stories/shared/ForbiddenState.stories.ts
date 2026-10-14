import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ForbiddenState from '../../app/components/shared/ForbiddenState.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/ForbiddenState',
  component: ForbiddenState,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/shared/PageState.vue:19') },
  render: args => ({
    components: { ForbiddenState, PageContainer },
    setup: () => ({ args }),
    template: '<main class="nasq-shell-main"><PageContainer width="detail"><ForbiddenState v-bind="args" /></PageContainer></main>',
  }),
} satisfies Meta<typeof ForbiddenState>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'بلا صلاحية' }
