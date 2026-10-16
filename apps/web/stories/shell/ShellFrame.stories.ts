import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import AppSidebar from '../../app/components/shell/AppSidebar.vue'
import ShellFrame from '@nasq/ui/app/components/shell/ShellFrame.vue'
import ShellHeader from '../../app/components/shell/ShellHeader.vue'
import { createBrandTheme } from '../../app/utils/brandTheme'
import { __getRouter, useCookie } from '../../.storybook/nuxt-shims'
import { shellHandlers, vendorShellHandlers } from '../handlers/shell'
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
const frame = (sidebar: 'open' | 'closed' = 'open', before?: () => void) => ({
  components: { AppSidebar, ShellFrame, ShellHeader },
  setup: () => {
    useCookie<'open' | 'closed'>('nasq-context-sidebar').value = sidebar
    before?.()
    return { t: useI18n().t }
  },
  template: `<ShellFrame>
    <template #header><ShellHeader /></template>
    <template #sidebar><AppSidebar /></template>
    <main class="nasq-shell-main" data-testid="shell-main"><div class="nasq-page-stack nasq-page-width-list"><h1 class="text-xl font-semibold">{{ t('nav.tasks') }}</h1></div></main>
  </ShellFrame>`,
})

export const Default: Story = {
  name: 'الإطار الكامل',
  parameters: storyContext('apps/web/app/layouts/default.vue:46'),
  loaders: [at('/tasks')],
  render: () => frame(),
}

export const Collapsed: Story = {
  name: 'القائمة السياقية مطويّة',
  parameters: storyContext('apps/web/app/layouts/default.vue:46', 'القائمة السياقية بعرض 48px: يبقى زر الطي والأيقونات فقط.'),
  loaders: [at('/tasks')],
  render: () => frame('closed'),
}

export const Console: Story = {
  name: 'الكونسول',
  parameters: { ...storyContext('apps/web/app/layouts/default.vue:46'), msw: { handlers: { api: vendorShellHandlers } } },
  loaders: [at('/vendor/overview')],
  render: () => frame(),
}

export const BrightTenant: Story = {
  name: 'لون مؤسسة ساطع',
  parameters: storyContext('apps/web/app/layouts/default.vue:46', 'لون المؤسسة لا يغيّر شريط الموديولات (المواصفة §3).'),
  loaders: [at('/tasks')],
  render: (_args, { globals }) => frame('open', () => {
    const theme = createBrandTheme('#ff00ff', globals.appearance === 'dark' ? 'dark' : 'light')
    for (const [key, value] of Object.entries(theme)) document.documentElement.style.setProperty(key, value)
  }),
}
