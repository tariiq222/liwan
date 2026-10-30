import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import AppSidebar from '../../app/components/shell/AppSidebar.vue'
import ShellFrame from '@liwan/ui/app/components/shell/ShellFrame.vue'
import ShellHeader from '../../app/components/shell/ShellHeader.vue'
import { __getRouter, useCookie } from '../../.storybook/nuxt-shims'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellFrame',
  component: ShellFrame,
  parameters: { layout: 'fullscreen', msw: { handlers: { api: shellHandlers } } },
} satisfies Meta<typeof ShellFrame>
export default meta
type Story = StoryObj<typeof meta>

/** Route for one story; loaders run before render. */
const at = (path: string) => async () => {
  await __getRouter()!.replace(path)
  return {}
}

// The sidebar state is set in setup: the global loader resets the shim state (cookie included) concurrently with story loaders.
const frame = (sidebar: 'open' | 'closed' = 'open') => ({
  components: { AppSidebar, ShellFrame, ShellHeader },
  setup: () => {
    useCookie<'open' | 'closed'>('liwan-context-sidebar').value = sidebar
    return { t: useI18n().t }
  },
  template: `<ShellFrame>
    <template #header><ShellHeader /></template>
    <template #sidebar><AppSidebar /></template>
    <main class="liwan-shell-main" data-testid="shell-main"><div class="liwan-page-stack liwan-page-width-list"><h1 class="text-xl font-semibold">{{ t('nav.tasks') }}</h1></div></main>
  </ShellFrame>`,
})

export const Default: Story = {
  name: 'الإطار الكامل',
  parameters: storyContext('apps/web/app/layouts/default.vue:72'),
  loaders: [at('/tasks')],
  render: () => frame(),
}

export const Collapsed: Story = {
  name: 'القائمة السياقية مطويّة',
  parameters: storyContext('apps/web/app/layouts/default.vue:72', 'القائمة السياقية بعرض 64px: يبقى زر الطي والأيقونات فقط.'),
  loaders: [at('/tasks')],
  render: () => frame('closed'),
}
