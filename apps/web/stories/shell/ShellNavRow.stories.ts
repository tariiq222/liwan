import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellNavRow from '@liwan/ui/app/components/shell/ShellNavRow.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellNavRow',
  component: ShellNavRow,
  args: { item: { id: 'crm', label: 'إدارة العملاء', icon: 'i-lucide-handshake', to: '/crm', active: false, app: 'crm' } },
  render: args => ({ components: { ShellNavRow }, setup: () => ({ args }), template: '<div class="liwan-shell" style="width: 264px; padding: 14px"><ShellNavRow v-bind="args" /></div>' }),
} satisfies Meta<typeof ShellNavRow>
export default meta
type Story = StoryObj<typeof meta>

const context = storyContext('packages/ui/app/components/shell/ShellNavSection.vue:65')

export const AppTile: Story = { name: 'تطبيق ببلاطته الملونة', parameters: context }
export const Active: Story = { name: 'الصفحة الحالية', parameters: context, args: { item: { id: 'tasks', label: 'مهامي', icon: 'i-lucide-check-square', to: '/my-tasks', active: true, app: 'tasks' } } }
export const WithCount: Story = { name: 'مع عدّاد', parameters: context, args: { item: { id: 'inbox', label: 'رسائل العملاء', icon: 'i-lucide-messages-square', to: '/inbox', active: false, app: 'inbox', count: 120 } } }
export const Plain: Story = { name: 'أيقونة عادية', parameters: context, args: { item: { id: 'home', label: 'يومي', icon: 'i-lucide-house', to: '/', active: false } } }
export const CreateAction: Story = { name: 'إجراء الإنشاء', parameters: context, args: { item: { id: 'new', label: 'مشروع جديد', icon: 'i-lucide-plus', to: '/projects/new', active: false, primary: true } } }
