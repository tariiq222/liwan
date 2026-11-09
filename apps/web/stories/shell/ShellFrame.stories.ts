import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import AppSidebar from '../../app/components/shell/AppSidebar.vue'
import AppTopBar from '../../app/components/shell/AppTopBar.vue'
import ShellFrame from '@liwan/ui/app/components/shell/ShellFrame.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
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

const frame = () => ({
  components: { AppSidebar, AppTopBar, ShellFrame },
  setup: () => ({ t: useI18n().t }),
  template: `<ShellFrame>
    <template #sidebar><AppSidebar /></template>
    <template #topbar><AppTopBar /></template>
    <main class="liwan-shell-main" data-testid="shell-main"><div class="liwan-page-stack"><h1 class="text-xl font-semibold">{{ t('nav.tasks') }}</h1></div></main>
  </ShellFrame>`,
})

export const Application: Story = {
  name: 'تطبيق مفتوح: قائمة التطبيق في الشريط الجانبي',
  parameters: storyContext('apps/web/app/layouts/default.vue:67'),
  loaders: [at('/tasks')],
  render: () => frame(),
}

export const Day: Story = {
  name: 'يومي: الشريط الجانبي العام',
  parameters: storyContext('apps/web/app/layouts/default.vue:67', 'في الصفحة الرئيسية يعرض الشريط المنظمة وتطبيقاتي وكل التطبيقات.'),
  loaders: [at('/')],
  render: () => frame(),
}
