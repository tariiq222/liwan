import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellOrgCard from '@liwan/ui/app/components/shell/ShellOrgCard.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellOrgCard',
  component: ShellOrgCard,
  parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:58'),
  args: { name: 'شركة الندى للتجارة', initial: 'ن' },
  render: args => ({ components: { ShellOrgCard }, setup: () => ({ args }), template: '<div class="liwan-shell" style="width: 264px; padding: 14px"><ShellOrgCard v-bind="args" /></div>' }),
} satisfies Meta<typeof ShellOrgCard>
export default meta
type Story = StoryObj<typeof meta>

export const Initial: Story = { name: 'الحرف الأول' }
export const Logo: Story = { name: 'شعار المنظمة', args: { logoUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Crect width=%2224%22 height=%2224%22 rx=%226%22 fill=%22teal%22/%3E%3C/svg%3E' } }
