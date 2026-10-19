import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import PageHeader from '@webvue/ui/app/components/shared/layout/PageHeader.vue'
import PageState from '@webvue/ui/app/components/shared/feedback/PageState.vue'
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
  template: `<main class="webvue-shell-main"><PageContainer v-bind="args"><PageHeader :title="t('tasks.title')" :description="t('tasks.description')" /><PageState :empty="true" /></PageContainer></main>`,
})

export const List: Story = { name: 'صفحة قائمة', args: { width: 'list' }, parameters: storyContext('packages/ui/app/components/shared/layout/ListPage.vue:47', 'داخل `main.webvue-shell-main` من `apps/web/app/layouts/default.vue:53`.'), render: page }
export const Detail: Story = { name: 'صفحة تفاصيل', args: { width: 'detail' }, parameters: storyContext('packages/ui/app/components/shared/layout/RecordPage.vue:38'), render: page }
export const Form: Story = { name: 'صفحة نموذج', args: { width: 'form' }, parameters: storyContext('apps/web/app/pages/projects/[id]/finance/[entryId]/edit.vue:66'), render: page }
export const Full: Story = { name: 'صفحة سجل بعرض كامل', args: { width: 'full' }, parameters: storyContext('apps/web/app/pages/projects/[id]/index.vue:36', 'بديل `!max-w-none`: صفحة سجل هي لوحة بطاقات (نظرة المشروع) تأخذ عرض مساحة العمل كله.'), render: page }
