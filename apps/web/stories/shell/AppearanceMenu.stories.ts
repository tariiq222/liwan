import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AppearanceMenu from '../../app/components/shell/AppearanceMenu.vue'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/AppearanceMenu',
  component: AppearanceMenu,
  parameters: { msw: { handlers: { api: shellHandlers } } },
} satisfies Meta<typeof AppearanceMenu>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'زر المظهر',
  parameters: storyContext('apps/web/app/components/shell/ShellHeader.vue:86'),
  render: () => ({ components: { AppearanceMenu }, template: '<div class="nasq-shell-header-actions"><AppearanceMenu /></div>' }),
}
