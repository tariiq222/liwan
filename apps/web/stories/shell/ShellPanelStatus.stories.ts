import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellPanelStatus from '@liwan/ui/app/components/shell/ShellPanelStatus.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellPanelStatus',
  component: ShellPanelStatus,
  parameters: storyContext('apps/web/app/components/chat/ChatQuickPanel.vue:22'),
  args: { kind: 'empty', message: 'لا محادثات بعد.' },
  render: args => ({ components: { ShellPanelStatus }, setup: () => ({ args }), template: '<div class="liwan-shell" style="width: 364px"><ShellPanelStatus v-bind="args" /></div>' }),
} satisfies Meta<typeof ShellPanelStatus>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { name: 'فارغة' }
export const Loading: Story = { name: 'جارٍ التحميل', args: { kind: 'loading', message: 'جارٍ التحميل…' } }
export const Failed: Story = { name: 'تعذّر التحميل', args: { kind: 'error', message: 'تعذّر تحميل القائمة.', retryLabel: 'إعادة المحاولة' } }
