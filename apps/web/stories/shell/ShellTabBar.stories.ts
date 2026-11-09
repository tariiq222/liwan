import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellTabBar from '@liwan/ui/app/components/shell/ShellTabBar.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellTabBar',
  component: ShellTabBar,
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobile1' }, ...storyContext('apps/web/app/components/shell/AppTabBar.vue:22') },
  args: {
    label: 'التنقل السريع',
    items: [
      { id: 'home', label: 'يومي', icon: 'i-lucide-house', to: '/', active: true },
      { id: 'tasks', label: 'مهامي', icon: 'i-lucide-check-square', to: '/my-tasks', active: false },
      { id: 'chat', label: 'المحادثات', icon: 'i-lucide-message-circle', to: '/chat', active: false },
      { id: 'ai', label: 'Liwan AI', icon: 'i-lucide-sparkles', to: '/ai', active: false },
      { id: 'more', label: 'المزيد', icon: 'i-lucide-layout-grid', active: false },
    ],
  },
  // The bar is only drawn below 768px; the story pins it in place so it shows at any width.
  render: args => ({ components: { ShellTabBar }, setup: () => ({ args }), template: '<div class="liwan-shell" style="height: 160px; position: relative"><ShellTabBar v-bind="args" style="display: flex; position: absolute" /></div>' }),
} satisfies Meta<typeof ShellTabBar>
export default meta
type Story = StoryObj<typeof meta>

export const Today: Story = { name: 'يومي مفتوحة' }
export const MoreLit: Story = { name: 'المزيد مضاءة على تطبيق آخر', args: { items: [
  { id: 'home', label: 'يومي', icon: 'i-lucide-house', to: '/', active: false },
  { id: 'tasks', label: 'مهامي', icon: 'i-lucide-check-square', to: '/my-tasks', active: false },
  { id: 'more', label: 'المزيد', icon: 'i-lucide-layout-grid', active: true },
] } }
