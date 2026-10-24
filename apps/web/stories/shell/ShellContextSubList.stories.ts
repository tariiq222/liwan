import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellContextSubList from '@webvue/ui/app/components/shell/ShellContextSubList.vue'
import { subListFixture } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellContextSubList',
  component: ShellContextSubList,
  parameters: { layout: 'fullscreen' },
  args: { label: 'الإعدادات', sections: subListFixture, collapsed: false },
} satisfies Meta<typeof ShellContextSubList>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'أقسام القائمة الفرعية',
  parameters: storyContext('packages/ui/app/components/shell/ShellNavigation.vue:70'),
  render: args => ({ components: { ShellContextSubList }, setup: () => ({ args }), template: '<div class="webvue-shell min-h-svh"><div class="webvue-context-column"><ShellContextSubList v-bind="args" /></div></div>' }),
}

// The collapsed bar: the shell sets the context sidebar to 64px, which the card follows.
export const Collapsed: Story = {
  ...Default,
  name: 'مطوية (أيقونات)',
  args: { collapsed: true },
  render: args => ({ components: { ShellContextSubList }, setup: () => ({ args }), template: '<div class="webvue-shell min-h-svh" style="--context-sidebar-width: 64px"><div class="webvue-context-column"><ShellContextSubList v-bind="args" /></div></div>' }),
}
