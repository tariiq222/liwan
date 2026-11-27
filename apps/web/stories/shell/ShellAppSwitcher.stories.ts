import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellAppSwitcher from '@liwan/ui/app/components/shell/ShellAppSwitcher.vue'
import { storyContext } from '../support/context'

// The application block of app mode. When the user pinned more than one application it opens them as a menu, so
// switching is one click without leaving the page; the old block was static and the switch went through /apps.
const pinned = [
  { id: 'crm', label: 'إدارة العملاء', icon: 'i-lucide-target', to: '/crm', testId: 'navigation-app-crm' },
  { id: 'finance', label: 'المالية', icon: 'i-lucide-landmark', to: '/finance', testId: 'navigation-app-finance' },
  { id: 'hr', label: 'الموارد البشرية', icon: 'i-lucide-users', to: '/hr', testId: 'navigation-app-hr' },
] as const

const meta = {
  title: 'Shell/ShellAppSwitcher',
  component: ShellAppSwitcher,
  parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:97'),
  args: { app: { id: 'crm', label: 'إدارة العملاء', icon: 'i-lucide-target' }, items: pinned, menuLabel: 'تبديل التطبيق' },
  render: args => ({ components: { ShellAppSwitcher }, setup: () => ({ args }), template: '<div class="liwan-shell" style="width: 264px; padding: 18px 14px"><ShellAppSwitcher v-bind="args" /></div>' }),
} satisfies Meta<typeof ShellAppSwitcher>
export default meta
type Story = StoryObj<typeof meta>

export const Switcher: Story = { name: 'كتلة التطبيق مع قائمة التبديل' }
export const OneApplication: Story = { name: 'تطبيق واحد مثبّت فلا قائمة', args: { items: pinned.slice(0, 1) } }
export const NoApplications: Story = { name: 'بلا تطبيقات مثبّتة', args: { items: [] } }
