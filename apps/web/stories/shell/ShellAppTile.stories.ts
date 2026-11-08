import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellAppTile from '@liwan/ui/app/components/shell/ShellAppTile.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellAppTile',
  component: ShellAppTile,
  parameters: storyContext('packages/ui/app/components/shell/ShellNavRow.vue:25'),
  args: { icon: 'i-lucide-handshake', app: 'crm', size: 'md' },
} satisfies Meta<typeof ShellAppTile>
export default meta
type Story = StoryObj<typeof meta>

export const Paid: Story = { name: 'تطبيق بلونه' }
export const Ink: Story = { name: 'تطبيق مجاني بالحبر', args: { icon: 'i-lucide-check-square', app: 'tasks' } }
export const Small: Story = { name: 'صغيرة 26px', args: { size: 'sm' } }
export const Large: Story = { name: 'كبيرة 44px', args: { size: 'lg' } }
