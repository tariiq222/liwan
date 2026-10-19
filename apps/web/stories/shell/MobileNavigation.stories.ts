import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MobileNavigation from '../../app/components/shell/MobileNavigation.vue'
import { mobileDrawer } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/MobileNavigation',
  component: MobileNavigation,
  parameters: { layout: 'fullscreen' },
  args: { ...mobileDrawer, title: '' },
} satisfies Meta<typeof MobileNavigation>
export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
  name: 'القائمة مفتوحة',
  parameters: storyContext('apps/web/app/components/shell/ShellHeader.vue:64'),
  render: args => ({
    components: { MobileNavigation },
    setup: () => ({ args, open: ref(true), t: useI18n().t }),
    template: '<div class="webvue-shell min-h-svh"><MobileNavigation v-bind="args" v-model:open="open" :title="t(\'nav.projects\')" /></div>',
  }),
}
