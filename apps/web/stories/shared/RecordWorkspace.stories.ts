import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import RecordWorkspace from '@liwan/ui/app/components/shared/layout/RecordWorkspace.vue'
import PropertyRow from '@liwan/ui/app/components/shared/layout/PropertyRow.vue'
import StatusBadge from '@liwan/ui/app/components/shared/data/StatusBadge.vue'
import { project } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/RecordWorkspace',
  component: RecordWorkspace,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('apps/web/app/components/pmo/tasks/TaskDetailPanel.vue:154', 'سجل داخل تطبيق: صف رأس واحد (الاسم والحالة والإجراءات)، والمسار الكامل فوقه وينتهي بالسجل نفسه، وعمود رئيسي بلا بطاقات، وخصائص نصية في نهاية السطر (وقبل المحتوى على الجوال). لا تبويبات ولا بلاطة تطبيق ولا سطر تعريف.'),
  },
} satisfies Meta<typeof RecordWorkspace>
export default meta
type Story = StoryObj

const workspace = (state: { loading?: boolean; error?: unknown; aside?: boolean } = {}) => ({
  components: { PropertyRow, RecordWorkspace, StatusBadge },
  setup() {
    const { t } = useI18n()
    const trail = [
      { label: t('nav.projects'), to: '/projects' },
      { label: project.name, to: '/projects/1' },
      { label: t('projects.tabs.tasks'), to: '/projects/1/tasks' },
      { label: project.name },
    ]
    return { t, project, trail, loading: state.loading ?? false, error: state.error, aside: state.aside ?? true }
  },
  template: `<main class="liwan-shell-main">
    <RecordWorkspace :title="loading ? '' : project.name" :trail="trail" back-to="/projects/1/tasks" :loading="loading" :error="error">
      <template #status><StatusBadge tone="info" :label="t('projects.status.' + project.status)" /></template>
      <template #actions><UButton color="neutral" variant="ghost" size="sm" square icon="i-lucide-ellipsis" :aria-label="t('app.actions')" /></template>
      <template #main>
        <p class="text-sm text-default">{{ project.name }}</p>
        <section class="grid gap-2"><h2 class="text-sm font-semibold text-highlighted">{{ t('projects.tabs.milestones') }}</h2><p class="text-sm text-muted">{{ t('app.noResults') }}</p></section>
      </template>
      <template v-if="aside" #aside>
        <dl class="divide-y divide-default">
          <PropertyRow :label="t('projects.columns.manager')" :value="project.manager?.name" />
          <PropertyRow :label="t('projects.columns.progress')" :value="project.progress + '%'" />
        </dl>
      </template>
    </RecordWorkspace>
  </main>`,
})

export const Default: Story = { name: 'سجل بخصائص', render: () => workspace() }
export const WithoutAside: Story = { name: 'بلا خصائص', render: () => workspace({ aside: false }) }
export const Loading: Story = { name: 'تحميل', render: () => workspace({ loading: true }) }
export const NotFound: Story = { name: 'غير موجود', render: () => workspace({ error: { status: 404 } }) }
