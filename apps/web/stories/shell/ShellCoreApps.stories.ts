import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellCoreApps from '@liwan/ui/app/components/shell/ShellCoreApps.vue'
import { coreAppRows } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellCoreApps',
  component: ShellCoreApps,
  parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:62'),
  args: { label: 'التطبيقات الأساسية', items: coreAppRows },
  render: args => ({ components: { ShellCoreApps }, setup: () => ({ args }), template: '<div class="liwan-shell" style="width: 264px; padding: 18px 14px"><ShellCoreApps v-bind="args" /></div>' }),
} satisfies Meta<typeof ShellCoreApps>
export default meta
type Story = StoryObj<typeof meta>

export const Row: Story = { name: 'صف الأيقونات مع الصفحة الحالية والعدّادات' }
export const OnlyReachable: Story = { name: 'ما يملكه المستخدم فقط', args: { items: coreAppRows.filter(item => ['home', 'tasks'].includes(item.id)) } }
