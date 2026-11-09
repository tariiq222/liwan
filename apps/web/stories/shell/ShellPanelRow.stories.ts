import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellPanelRow from '@liwan/ui/app/components/shell/ShellPanelRow.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellPanelRow',
  component: ShellPanelRow,
  parameters: storyContext('apps/web/app/components/chat/ChatQuickPanel.vue:26'),
  args: { title: 'محمد القحطاني', caption: 'راجعت العرض، تمام', lead: 'م', to: '/chat/1' },
  render: args => ({ components: { ShellPanelRow }, setup: () => ({ args }), template: '<div class="liwan-shell" style="width: 364px; padding: 8px"><ShellPanelRow v-bind="args" /></div>' }),
} satisfies Meta<typeof ShellPanelRow>
export default meta
type Story = StoryObj<typeof meta>

export const Person: Story = { name: 'شخص أو محادثة' }
export const Unread: Story = { name: 'غير مقروءة', args: { unread: true } }
export const Task: Story = { name: 'مهمة', args: { lead: undefined, check: true, title: 'تجهيز عقد متجر وردة', caption: 'اليوم 3:00 م' } }
export const Done: Story = { name: 'مهمة منجزة', args: { lead: undefined, check: true, done: true, title: 'إرسال عرض الندى', caption: 'أُنجزت' } }
export const IconTile: Story = { name: 'بلاطة أيقونة', args: { lead: undefined, icon: 'i-lucide-bell', title: 'طلب شراء ينتظر موافقتك', caption: 'قبل 3 ساعات', to: undefined } }
