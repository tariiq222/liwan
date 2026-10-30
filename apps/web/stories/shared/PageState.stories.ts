import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SettingsPage from '@liwan/ui/app/components/shared/layout/SettingsPage.vue'
import PageState from '@liwan/ui/app/components/shared/feedback/PageState.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PageState',
  component: PageState,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/team/users/[userId]/security.vue:30') },
  args: { loading: false, empty: false, error: undefined, emptyText: undefined },
  render: args => ({
    components: { SettingsPage, PageState },
    setup: () => ({ args }),
    template: `<main class="liwan-shell-main"><SettingsPage width="list"><div id="results" class="liwan-settings-anchor"><PageState v-bind="args"><div class="rounded-card ring ring-default bg-default overflow-hidden p-5 text-sm">{{ $t('app.noResults') }}</div></PageState></div></SettingsPage></main>`,
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

export const RefreshFailed: Story = { name: 'تعذر تحديث بيانات ظاهرة', args: { error: { status: 500 }, keepContent: true } }
export const FirstUse: Story = { name: 'فراغ مع الخطوة التالية', args: { empty: true, emptyText: 'لا توجد سجلات بعد', emptyDescription: 'ابدأ بإنشاء أول سجل.' }, render: args => ({ components: { PageState }, setup: () => ({ args }), template: `<PageState v-bind="args"><template #emptyAction><UButton to="/projects/new">{{ $t('app.create') }}</UButton></template></PageState>` }) }
