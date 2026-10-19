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

export const Default: Story = {
  name: 'الشريط والقائمة السياقية',
  parameters: storyContext('apps/web/app/layouts/default.vue:62'),
  loaders: [async () => { await __getRouter()!.replace('/projects'); return {} }],
  render: () => ({ components: { AppSidebar }, template: '<div class="webvue-shell min-h-svh"><AppSidebar /></div>' }),
}
