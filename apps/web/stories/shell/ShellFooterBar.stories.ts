import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellFooterBar from '@liwan/ui/app/components/shell/ShellFooterBar.vue'
import ShellNavSection from '@liwan/ui/app/components/shell/ShellNavSection.vue'
import { footerRows, footerTools } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellFooterBar',
  component: ShellFooterBar,
  parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:90'),
  args: { label: 'اختصارات عامة', tools: footerTools, expandLabel: 'عرض القائمة بالأسماء', collapseLabel: 'إخفاء الأسماء' },
  render: args => ({
    components: { ShellFooterBar, ShellNavSection },
    setup: () => ({ args, footerRows }),
    template: '<div class="liwan-shell" style="width: 264px; padding: 18px 14px"><ShellFooterBar v-bind="args"><ShellNavSection label="روابط عامة" :items="footerRows" /></ShellFooterBar></div>',
  }),
} satisfies Meta<typeof ShellFooterBar>
export default meta
type Story = StoryObj<typeof meta>

export const Collapsed: Story = { name: 'صف الأيقونات مغلقًا' }
export const Expanded: Story = { name: 'القائمة مفتوحة', args: { expanded: true } }
export const OpenPage: Story = {
  name: 'الصفحة الحالية',
  args: { tools: footerTools.map(tool => ({ ...tool, active: tool.id === 'settings' })) },
}
