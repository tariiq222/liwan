import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellQuickViews from '@webvue/ui/app/components/shell/ShellQuickViews.vue'
import { quickActionItems, quickViewItems } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellQuickViews',
  component: ShellQuickViews,
  parameters: { layout: 'fullscreen' },
  args: { label: 'عروض وإجراءات سريعة', views: quickViewItems, actions: quickActionItems, collapsed: false },
} satisfies Meta<typeof ShellQuickViews>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'مهام: عروض وإجراءات',
  parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:62'),
  render: args => ({ components: { ShellQuickViews }, setup: () => ({ args }), template: '<div class="webvue-shell min-h-svh"><div class="webvue-context-column"><ShellQuickViews v-bind="args" /></div></div>' }),
}

export const ActionsOnly: Story = { ...Default, name: 'إجراءات فقط', args: { views: [] } }

// The collapsed bar: the shell sets the context sidebar to 64px, which the card follows.
export const Collapsed: Story = {
  ...Default,
  name: 'مطوية (أيقونات)',
  args: { collapsed: true },
  render: args => ({ components: { ShellQuickViews }, setup: () => ({ args }), template: '<div class="webvue-shell min-h-svh" style="--context-sidebar-width: 64px"><div class="webvue-context-column"><ShellQuickViews v-bind="args" /></div></div>' }),
}
