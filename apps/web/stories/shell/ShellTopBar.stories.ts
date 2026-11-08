import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellTopBar from '@liwan/ui/app/components/shell/ShellTopBar.vue'
import ShellToolButton from '@liwan/ui/app/components/shell/ShellToolButton.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellTopBar',
  component: ShellTopBar,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/components/shell/AppTopBar.vue:60') },
  args: { label: 'رأس التطبيق' },
  render: args => ({
    components: { ShellTopBar, ShellToolButton }, setup: () => ({ args }),
    template: `<div class="liwan-shell" style="min-height: 120px"><ShellTopBar v-bind="args">
      <template #search><div class="liwan-search-trigger" style="height: 42px; display: flex; align-items: center; padding-inline: 14px; border-radius: 12px; box-shadow: inset 0 0 0 1px var(--ui-border)">ابحث عن عميل أو مهمة أو مستند</div></template>
      <template #end><ShellToolButton variant="outline" icon="i-lucide-moon" label="الوضع الليلي" /><div class="liwan-tools"><ShellToolButton icon="i-lucide-bell" label="الإشعارات" :badge="3" /><ShellToolButton icon="i-lucide-message-circle" label="المحادثات" :badge="2" /><ShellToolButton icon="i-lucide-calendar-days" label="الاجتماعات" badge="dot" /></div></template>
    </ShellTopBar></div>`,
  }),
} satisfies Meta<typeof ShellTopBar>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'الشريط العلوي المسطّح' }
