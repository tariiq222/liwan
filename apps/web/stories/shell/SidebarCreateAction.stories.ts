import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SidebarCreateAction from '../../app/components/shell/SidebarCreateAction.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/SidebarCreateAction',
  component: SidebarCreateAction,
  args: { to: '/projects/new', label: '', active: false },
} satisfies Meta<typeof SidebarCreateAction>
export default meta
type Story = StoryObj<typeof meta>

export const InContextSidebar: Story = {
  name: 'في الشريط الجانبي',
  parameters: storyContext('unused', 'لم يعد مستخدمًا بعد تحديث الشريط الجانبي؛ الغلاف بعرض `--context-sidebar-width: 230px` من `packages/ui/app/assets/css/shell.css`.'),
  render: args => ({
    components: { SidebarCreateAction },
    setup: () => ({ args }),
    template: `<div style="width: 230px"><div class="webvue-context-create-actions"><SidebarCreateAction :to="args.to" :label="args.label || $t('nav.newProject')" :active="args.active" /><SidebarCreateAction to="/meetings/new" :label="$t('nav.newMeeting')" /></div></div>`,
  }),
}

export const Active: Story = { ...InContextSidebar, name: 'نشط', args: { to: '/projects/new', label: '', active: true } }
