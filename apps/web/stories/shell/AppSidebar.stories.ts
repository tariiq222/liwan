import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AppSidebar from '../../app/components/shell/AppSidebar.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/AppSidebar',
  component: AppSidebar,
  parameters: { layout: 'fullscreen', msw: { handlers: { api: shellHandlers } } },
} satisfies Meta<typeof AppSidebar>
export default meta
type Story = StoryObj<typeof meta>

const at = (path: string) => async () => { await __getRouter()!.replace(path); return {} }
const render = (surface: 'sidebar' | 'drawer' = 'sidebar') => () => ({ components: { AppSidebar }, setup: () => ({ surface }), template: '<div class="liwan-shell min-h-svh"><AppSidebar :surface="surface" /></div>' })

export const Global: Story = { name: 'عام: المنظمة ويومي وتطبيقاتي', parameters: storyContext('apps/web/app/layouts/default.vue:65'), loaders: [at('/')], render: render() }
export const Application: Story = { name: 'تطبيق مفتوح: رجوع وكتلة التطبيق وروابطه', parameters: storyContext('apps/web/app/layouts/default.vue:65'), loaders: [at('/projects')], render: render() }
export const Settings: Story = { name: 'الإعدادات بالنمط نفسه', parameters: storyContext('apps/web/app/layouts/default.vue:65'), loaders: [at('/settings/team/users')], render: render() }
export const Drawer: Story = { name: 'داخل درج الجوال', parameters: storyContext('apps/web/app/components/shell/AppDrawer.vue:25'), loaders: [at('/projects')], render: render('drawer') }
