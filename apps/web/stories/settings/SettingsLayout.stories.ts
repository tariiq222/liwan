import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import SettingsLayout from '../../app/components/settings/SettingsLayout.vue'
import PageHeader from '../../app/components/shared/PageHeader.vue'
import PageState from '../../app/components/shared/PageState.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Settings/SettingsLayout',
  component: SettingsLayout,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsLayout>
export default meta
type Story = StoryObj<typeof meta>

const layout = (width: 'list' | 'detail' | 'form', title: string): Story['render'] => () => ({
  components: { SettingsLayout, PageHeader, PageState },
  setup: () => ({ t: useI18n().t, width, title }),
  template: `<main class="nasq-shell-main"><SettingsLayout :width="width"><PageHeader :title="t(title)" /><PageState :empty="true" /></SettingsLayout></main>`,
})

export const FormPage: Story = { name: 'صفحة إعداد بنموذج', parameters: storyContext('apps/web/app/pages/settings/appearance.vue:9'), render: layout('form', 'settings.appearance.title') }
export const ListPage: Story = { name: 'صفحة إعداد بقائمة', parameters: storyContext('apps/web/app/pages/settings/access-log/index.vue:49'), render: layout('list', 'access.audit.title') }
export const DetailPage: Story = { name: 'صفحة إعداد بتفاصيل', parameters: storyContext('apps/web/app/pages/settings/access-log/[eventId].vue:20'), render: layout('detail', 'access.audit.detailTitle') }
