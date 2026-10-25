import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellContextSubList from '@webvue/ui/app/components/shell/ShellContextSubList.vue'
import { subListFixture } from '../fixtures/shell'
import { storyContext } from '../support/context'
import { ref } from 'vue'

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
  parameters: storyContext('packages/ui/app/components/shell/ShellNavigation.vue:87'),
  render: args => ({ components: { ShellContextSubList }, setup: () => ({ args }), template: '<div class="webvue-shell min-h-svh"><div class="webvue-context-column"><ShellContextSubList v-bind="args" /></div></div>' }),
}

// The collapsed bar: the shell sets the context sidebar to 64px, which the card follows.
export const Collapsed: Story = {
  ...Default,
  name: 'مطوية (أيقونات)',
  args: { collapsed: true },
  render: args => ({ components: { ShellContextSubList }, setup: () => ({ args }), template: '<div class="webvue-shell min-h-svh" style="--context-sidebar-width: 64px"><div class="webvue-context-column"><ShellContextSubList v-bind="args" /></div></div>' }),
}

export const Nested: Story = {
  name: 'أقسام وفلاتر متداخلة',
  parameters: Default.parameters,
  args: { sections: [{ id: 'settings', title: '', items: [{ id: 'team', label: 'الفريق', icon: 'i-lucide-users', to: '/settings/team', testId: 'team', children: [
    { id: 'users', label: 'المستخدمون', icon: 'i-lucide-user-cog', to: '/settings/team/users', testId: 'users', children: [
      { id: 'all', label: 'عرض الكل', icon: 'i-lucide-users', to: '/settings/team/users', testId: 'all' },
      { id: 'active', label: 'نشط', icon: 'i-lucide-user-check', to: '/settings/team/users?status=active', testId: 'active', active: true },
    ] },
    { id: 'roles', label: 'الأدوار', icon: 'i-lucide-shield-check', to: '/settings/team/roles', testId: 'roles' },
  ] }] }] },
  render: args => ({
    components: { ShellContextSubList },
    setup() {
      const openPath = ref(['team', 'users'])
      const disclose = (path: string[], open: boolean) => { openPath.value = open ? path : path.slice(0, -1) }
      return { args, openPath, disclose }
    },
    template: '<div class="webvue-shell min-h-svh"><div class="webvue-context-column"><ShellContextSubList v-bind="args" :open-path="openPath" :hydrated="true" @disclose="disclose" /></div></div>',
  }),
}
