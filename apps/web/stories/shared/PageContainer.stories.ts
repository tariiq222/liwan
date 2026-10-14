import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import PageHeader from '../../app/components/shared/PageHeader.vue'
import PageState from '../../app/components/shared/PageState.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PageContainer',
  component: PageContainer,
  parameters: { layout: 'fullscreen' },
  argTypes: { width: { control: 'inline-radio', options: ['list', 'detail', 'form'] } },
} satisfies Meta<typeof PageContainer>
export default meta
type Story = StoryObj<typeof meta>

const page: Story['render'] = args => ({
  components: { PageContainer, PageHeader, PageState },
  setup: () => ({ args, t: useI18n().t }),
  template: `<main class="nasq-shell-main"><PageContainer v-bind="args"><PageHeader :title="t('tasks.title')" :description="t('tasks.description')" /><PageState :empty="true" /></PageContainer></main>`,
})

export const List: Story = { name: 'صفحة قائمة', args: { width: 'list' }, parameters: storyContext('apps/web/app/components/shared/ListPage.vue:42', 'داخل `main.nasq-shell-main` من `apps/web/app/layouts/default.vue:53`.'), render: page }
export const Detail: Story = { name: 'صفحة تفاصيل', args: { width: 'detail' }, parameters: storyContext('apps/web/app/components/shared/RecordPage.vue:31'), render: page }
export const Form: Story = { name: 'صفحة نموذج', args: { width: 'form' }, parameters: storyContext('apps/web/app/pages/projects/[id]/finance/[entryId]/edit.vue:66'), render: page }
