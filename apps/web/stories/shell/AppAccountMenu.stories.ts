import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AppAccountMenu from '../../app/components/shell/AppAccountMenu.vue'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/AppAccountMenu',
  component: AppAccountMenu,
  parameters: { msw: { handlers: { api: shellHandlers } } },
} satisfies Meta<typeof AppAccountMenu>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'الحساب',
  parameters: storyContext('apps/web/app/components/shell/ShellHeader.vue:81'),
  render: () => ({ components: { AppAccountMenu }, template: '<div class="liwan-shell-header-actions"><AppAccountMenu /></div>' }),
}
