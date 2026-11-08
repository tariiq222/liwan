import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellAccountCard from '@liwan/ui/app/components/shell/ShellAccountCard.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellAccountCard',
  component: ShellAccountCard,
  parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:92'),
  args: { name: 'سارة العتيبي', initial: 'س', caption: 'مديرة المبيعات', to: '/account', connected: true, label: 'الخدمة الذاتية: سارة العتيبي', connectedLabel: 'متصل', disconnectedLabel: 'غير متصل' },
  render: args => ({ components: { ShellAccountCard }, setup: () => ({ args }), template: '<div class="liwan-shell" style="width: 264px; padding: 14px"><ShellAccountCard v-bind="args" /></div>' }),
} satisfies Meta<typeof ShellAccountCard>
export default meta
type Story = StoryObj<typeof meta>

export const Connected: Story = { name: 'متصل' }
export const Disconnected: Story = { name: 'غير متصل', args: { connected: false } }
export const NoCaption: Story = { name: 'بلا دور', args: { caption: undefined, connected: null } }
