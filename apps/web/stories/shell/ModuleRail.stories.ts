import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ModuleRail from '@webvue/ui/app/components/shell/ModuleRail.vue'
import { shellRail } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ModuleRail',
  component: ModuleRail,
  parameters: { layout: 'fullscreen' },
  args: { modules: shellRail.primary, utility: shellRail.utility, activeId: 'projects', homeTo: '/projects/dashboard' },
} satisfies Meta<typeof ModuleRail>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'المشاريع نشطة',
  parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:44'),
  render: args => ({ components: { ModuleRail }, setup: () => ({ args }), template: '<div class="webvue-shell"><ModuleRail v-bind="args" /></div>' }),
}

export const SettingsActive: Story = { ...Default, name: 'الإعدادات نشطة', args: { activeId: 'settings' } }
