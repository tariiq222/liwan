import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import PageHeader from '@webvue/ui/app/components/shared/layout/PageHeader.vue'
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
  parameters: storyContext('apps/web/app/pages/projects/[id]/settings.vue:19'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="webvue-shell-main"><PageContainer width="list"><PageHeader :title="t('tasks.title')" :description="t('tasks.description')"><template #actions><UButton icon="i-lucide-plus">{{ t('tasks.new') }}</UButton><UButton color="neutral" variant="outline">{{ t('taskLifecycle.archivedTasks') }}</UButton></template></PageHeader></PageContainer></main>`,
  }),
}

export const WithBack: Story = {
  name: 'مع زر الرجوع',
  parameters: storyContext('apps/web/app/pages/projects/[id]/finance/[entryId]/edit.vue:67'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="webvue-shell-main"><PageContainer width="form"><PageHeader :title="t('app.search')" back-to="/tasks" /></PageContainer></main>`,
  }),
}

export const TitleAndDescription: Story = {
  name: 'عنوان ووصف',
  parameters: storyContext('apps/web/app/pages/account.vue:10'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="webvue-shell-main"><PageContainer width="form"><PageHeader :title="t('account.title')" :description="t('account.description')" /></PageContainer></main>`,
  }),
}

export const HiddenTitle: Story = {
  name: 'عنوان يملكه الإطار',
  parameters: storyContext('unused', 'داخل إطار مشروع يملك العنوان: `hideTitle` يرسم الإجراءات وحدها ويبقى اسم الصفحة مسجلًا للغلاف.'),
  render: () => ({
    components: { PageContainer, PageHeader },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="webvue-shell-main"><PageContainer width="list"><h1 class="text-xl font-semibold text-highlighted">{{ t('projects.title') }}</h1><PageHeader :title="t('tasks.title')" hide-title><template #actions><UButton icon="i-lucide-plus">{{ t('tasks.new') }}</UButton></template></PageHeader></PageContainer></main>`,
  }),
}
