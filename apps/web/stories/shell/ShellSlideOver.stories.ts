import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellSlideOver from '@liwan/ui/app/components/shell/ShellSlideOver.vue'
import ShellPanelRow from '@liwan/ui/app/components/shell/ShellPanelRow.vue'
import ShellAppTile from '@liwan/ui/app/components/shell/ShellAppTile.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellSlideOver',
  component: ShellSlideOver,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/components/shell/SlideOverHost.vue:70') },
  args: { open: true, id: 'slide-over-tasks', title: 'مهامي', closeLabel: 'إغلاق', allTo: '/my-tasks', allLabel: 'افتح الكل' },
  render: args => ({
    components: { ShellSlideOver, ShellPanelRow, ShellAppTile }, setup: () => ({ args }),
    template: `<div class="liwan-shell" style="min-height: 460px"><ShellSlideOver v-bind="args">
      <template #lead><ShellAppTile icon="i-lucide-check-square" app="tasks" size="md" /></template>
      <ShellPanelRow check title="تجهيز عقد متجر وردة" caption="اليوم 3:00 م" to="/my-tasks/1" />
      <ShellPanelRow check title="متابعة مؤسسة البيان" caption="اليوم" to="/my-tasks/2" />
      <ShellPanelRow check done title="إرسال عرض الندى" caption="أُنجزت" to="/my-tasks/3" />
    </ShellSlideOver></div>`,
  }),
} satisfies Meta<typeof ShellSlideOver>
export default meta
type Story = StoryObj<typeof meta>

export const Tasks: Story = { name: 'مهامي' }
export const Closed: Story = { name: 'مغلقة: مخفية فقط', args: { open: false } }
export const NoAllLink: Story = { name: 'بلا رابط افتح الكل', args: { allTo: undefined } }
