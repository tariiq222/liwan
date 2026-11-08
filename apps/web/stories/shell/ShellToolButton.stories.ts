import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellToolButton from '@liwan/ui/app/components/shell/ShellToolButton.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellToolButton',
  component: ShellToolButton,
  parameters: { layout: 'centered', ...storyContext('apps/web/app/components/shell/AppTopBar.vue:78') },
  args: { icon: 'i-lucide-bell', label: 'الإشعارات', badge: 3, controls: 'slide-over-notifications' },
  render: args => ({ components: { ShellToolButton }, setup: () => ({ args }), template: '<div class="liwan-shell" style="padding: 24px"><div class="liwan-tools"><ShellToolButton v-bind="args" /></div></div>' }),
} satisfies Meta<typeof ShellToolButton>
export default meta
type Story = StoryObj<typeof meta>

export const WithCount: Story = { name: 'مع عدّاد' }
export const Open: Story = { name: 'اللوحة مفتوحة', args: { open: true } }
export const Dot: Story = { name: 'نقطة بلا رقم', args: { badge: 'dot' } }
export const NoBadge: Story = { name: 'بلا شارة', args: { badge: null } }
export const Outline: Story = { name: 'زر مستقل بإطار', args: { variant: 'outline', icon: 'i-lucide-moon', label: 'الوضع الليلي', badge: null, controls: undefined } }
