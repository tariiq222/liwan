import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import SettingsPage from '../../app/components/shared/SettingsPage.vue'
import PageHeader from '../../app/components/shared/PageHeader.vue'
import PageState from '../../app/components/shared/PageState.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/SettingsPage',
  component: SettingsPage,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
} satisfies Meta<typeof SettingsPage>
export default meta
type Story = StoryObj<typeof meta>

const layout = (width: 'list' | 'detail' | 'form', title: string): Story['render'] => () => ({
  components: { SettingsPage, PageHeader, PageState },
  setup: () => ({ t: useI18n().t, width, title }),
  template: `<main class="nasq-shell-main"><SettingsPage :width="width"><PageHeader :title="t(title)" /><PageState :empty="true" /></SettingsPage></main>`,
})

export const FormPage: Story = { name: 'صفحة إعداد بنموذج', parameters: storyContext('apps/web/app/pages/projects/settings.vue:14'), render: layout('form', 'settings.projects.title') }
export const ListPage: Story = { name: 'صفحة إعداد بقائمة', parameters: storyContext('apps/web/app/pages/subscription/branches.vue:9'), render: layout('list', 'access.audit.title') }
export const DetailPage: Story = { name: 'صفحة إعداد بتفاصيل', parameters: storyContext('apps/web/app/pages/subscription/index.vue:30'), render: layout('detail', 'access.audit.detailTitle') }
