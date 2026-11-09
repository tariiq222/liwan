import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AppTopBar from '../../app/components/shell/AppTopBar.vue'
import SlideOverHost from '../../app/components/shell/SlideOverHost.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/AppTopBar',
  component: AppTopBar,
  parameters: { layout: 'fullscreen', msw: { handlers: { api: shellHandlers } } },
} satisfies Meta<typeof AppTopBar>
export default meta
type Story = StoryObj<typeof meta>

const at = (path: string) => async () => { await __getRouter()!.replace(path); return {} }
const render = () => ({ components: { AppTopBar, SlideOverHost }, template: '<div class="liwan-shell" style="min-height: 320px"><AppTopBar /><SlideOverHost /></div>' })

export const Default: Story = { name: 'البحث والأدوات الشخصية وزر المساعد', parameters: storyContext('apps/web/app/layouts/default.vue:66'), loaders: [at('/tasks')], render }
