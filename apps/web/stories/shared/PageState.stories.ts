import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SettingsPage from '../../app/components/shared/SettingsPage.vue'
import PageState from '../../app/components/shared/PageState.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PageState',
  component: PageState,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/users/[userId]/security.vue:29') },
  args: { loading: false, empty: false, error: undefined, emptyText: undefined },
  render: args => ({
    components: { SettingsPage, PageState },
    setup: () => ({ args }),
    template: `<main class="nasq-shell-main"><SettingsPage width="list"><div id="results" class="nasq-settings-anchor"><PageState v-bind="args"><div class="rounded-lg ring ring-default bg-default overflow-hidden p-5 text-sm">{{ $t('app.noResults') }}</div></PageState></div></SettingsPage></main>`,
  }),
} satisfies Meta<typeof PageState>
export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = { name: 'تحميل', args: { loading: true } }
export const ErrorState: Story = { name: 'خطأ عام', args: { error: { status: 500 } } }
export const Forbidden: Story = { name: 'غير مصرح', args: { error: { status: 403 } } }
export const NotFound: Story = { name: 'غير موجود', args: { error: { status: 404 } } }
export const Empty: Story = { name: 'فارغ', args: { empty: true } }
export const Content: Story = { name: 'المحتوى' }
