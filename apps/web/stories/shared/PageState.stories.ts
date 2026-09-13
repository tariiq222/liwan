import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SettingsLayout from '../../app/components/settings/SettingsLayout.vue'
import PageState from '../../app/components/shared/PageState.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PageState',
  component: PageState,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/settings/access-log/index.vue:76') },
  args: { loading: false, empty: false, error: undefined, emptyText: undefined },
  render: args => ({
    components: { SettingsLayout, PageState },
    setup: () => ({ args }),
    template: `<main class="nasq-shell-main"><SettingsLayout width="list"><div id="results" class="nasq-settings-anchor"><PageState v-bind="args"><div class="nasq-ui-record-surface p-5 text-sm">{{ $t('app.noResults') }}</div></PageState></div></SettingsLayout></main>`,
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
