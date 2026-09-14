import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import PageHeader from '../../app/components/shared/PageHeader.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PageHeader',
  component: PageHeader,
  parameters: { layout: 'fullscreen' },
  args: { title: '' },
} satisfies Meta<typeof PageHeader>
export default meta
type Story = StoryObj<typeof meta>

export const WithActions: Story = {
  name: 'مع إجراءات الصفحة',
  parameters: storyContext('apps/web/app/pages/tasks.vue:48'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="nasq-shell-main"><PageContainer width="list"><PageHeader :title="t('tasks.title')" :description="t('tasks.description')"><template #actions><UButton icon="i-lucide-plus">{{ t('tasks.new') }}</UButton><UButton color="neutral" variant="outline">{{ t('taskLifecycle.archivedTasks') }}</UButton></template></PageHeader></PageContainer></main>`,
  }),
}

export const WithBack: Story = {
  name: 'مع زر الرجوع',
  parameters: storyContext('apps/web/app/pages/search.vue:39'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="nasq-shell-main"><PageContainer width="form"><PageHeader :title="t('app.search')" back-to="/tasks" /></PageContainer></main>`,
  }),
}

export const TitleAndDescription: Story = {
  name: 'عنوان ووصف',
  parameters: storyContext('apps/web/app/pages/account.vue:10'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="nasq-shell-main"><PageContainer width="form"><PageHeader :title="t('account.title')" :description="t('account.description')" /></PageContainer></main>`,
  }),
}
