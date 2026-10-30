import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import PageHeader from '@liwan/ui/app/components/shared/layout/PageHeader.vue'
import PageState from '@liwan/ui/app/components/shared/feedback/PageState.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PageContainer',
  component: PageContainer,
  parameters: { layout: 'fullscreen' },
  argTypes: { width: { control: 'inline-radio', options: ['list', 'detail', 'form', 'full'] } },
} satisfies Meta<typeof PageContainer>
export default meta
type Story = StoryObj<typeof meta>

const page: Story['render'] = args => ({
  components: { PageContainer, PageHeader, PageState },
  setup: () => ({ args, t: useI18n().t }),
  template: `<main class="liwan-shell-main"><PageContainer v-bind="args"><PageHeader :title="t('tasks.title')" /><PageState :empty="true" /></PageContainer></main>`,
})

export const List: Story = { name: 'صفحة قائمة', args: { width: 'list' }, parameters: storyContext('packages/ui/app/components/shared/layout/ListPage.vue:48', 'داخل `main.liwan-shell-main` من `apps/web/app/layouts/default.vue:53`.'), render: page }
export const Detail: Story = { name: 'صفحة تفاصيل', args: { width: 'detail' }, parameters: storyContext('packages/ui/app/components/shared/layout/RecordPage.vue:37'), render: page }
export const Form: Story = { name: 'صفحة نموذج', args: { width: 'form' }, parameters: storyContext('apps/web/app/pages/projects/[id]/finance/[entryId]/edit.vue:66'), render: page }
export const Full: Story = { name: 'صفحة سجل بعرض كامل', args: { width: 'full' }, parameters: storyContext('apps/web/app/pages/ai/index.vue:166', 'بديل `!max-w-none`: صفحة المساعد محادثة تأخذ عرض مساحة العمل كله.'), render: page }
