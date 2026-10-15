import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellHeader from '../../app/components/shell/ShellHeader.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { shellHandlers, vendorShellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellHeader',
  component: ShellHeader,
  parameters: { layout: 'fullscreen', msw: { handlers: { api: shellHandlers } } },
} satisfies Meta<typeof ShellHeader>
export default meta
type Story = StoryObj<typeof meta>

const at = (path: string) => async () => { await __getRouter()!.replace(path); return {} }
const render = () => ({ components: { ShellHeader }, template: '<div class="nasq-shell" style="min-height: 64px"><ShellHeader /></div>' })

export const Default: Story = { name: 'مهامي', parameters: storyContext('apps/web/app/layouts/default.vue:47'), loaders: [at('/tasks')], render }
export const Console: Story = { name: 'الكونسول', parameters: { ...storyContext('apps/web/app/layouts/default.vue:47'), msw: { handlers: { api: vendorShellHandlers } } }, loaders: [at('/vendor/overview')], render }
