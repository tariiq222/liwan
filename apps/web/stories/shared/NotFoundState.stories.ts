import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import NotFoundState from '@liwan/ui/app/components/shared/feedback/NotFoundState.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/NotFoundState',
  component: NotFoundState,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' }, ...storyContext('packages/ui/app/components/shared/feedback/PageState.vue:20') },
} satisfies Meta<typeof NotFoundState>
export default meta
type Story = StoryObj<typeof meta>

export const WithBack: Story = {
  name: 'مع رابط الرجوع',
  render: () => ({
    components: { NotFoundState, PageContainer },
    setup: () => ({ t: useI18n().t }),
    template: '<main class="liwan-shell-main"><PageContainer width="detail"><NotFoundState back-to="/projects" :back-label="t(\'nav.projects\')" /></PageContainer></main>',
  }),
}
export const Bare: Story = {
  name: 'بلا رابط',
  render: () => ({
    components: { NotFoundState, PageContainer },
    template: '<main class="liwan-shell-main"><PageContainer width="detail"><NotFoundState /></PageContainer></main>',
  }),
}
