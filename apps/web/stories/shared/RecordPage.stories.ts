import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PropertiesPanel from '@webvue/ui/app/components/shared/layout/PropertiesPanel.vue'
import PropertyRow from '@webvue/ui/app/components/shared/layout/PropertyRow.vue'
import RecordPage from '@webvue/ui/app/components/shared/layout/RecordPage.vue'
import RecordSection from '@webvue/ui/app/components/shared/layout/RecordSection.vue'
import { project } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/RecordPage',
  component: RecordPage,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('unused', 'قالب السجل: الرأس مع الرجوع والإجراءات، والتبويبات، والعمود الرئيسي، وعمود الخصائص في نهاية السطر (وتحت المحتوى على الجوال).'),
  },
} satisfies Meta<typeof RecordPage>
export default meta
type Story = StoryObj

// The tabs slot holds a plain labelled nav here; SharedRouteTabs fills it once a page adopts the template.
const record = (state: { loading?: boolean; error?: unknown; backSlot?: boolean; summary?: boolean } = {}) => ({
  components: { PropertiesPanel, PropertyRow, RecordPage, RecordSection },
  setup() {
    const { t } = useI18n()
    return { t, project, loading: state.loading ?? false, error: state.error }
  },
  template: `<main class="webvue-shell-main">
    <RecordPage :title="loading ? '' : project.name" :description="t('projects.description')" back-to="/projects" :back-label="t('projects.backToProjects')" :loading="loading" :error="error">
      ${state.backSlot ? `<template #back><UButton to="/projects" color="neutral" variant="ghost" icon="i-lucide-arrow-right" data-testid="task-detail-back">{{ t('projects.backToProjects') }}</UButton></template>` : ''}
      <template #actions><UButton color="neutral" variant="outline" icon="i-lucide-pencil">{{ t('app.edit') }}</UButton></template>
      ${state.summary ? `<template #summary><PropertiesPanel :title="t('states.properties')"><PropertyRow :label="t('projects.columns.manager')" :value="project.manager?.name" /><PropertyRow :label="t('projects.columns.dateEnd')" :value="project.date_end" /></PropertiesPanel></template>` : ''}
      <template #tabs>
        <nav :aria-label="t('projects.title')" class="flex gap-4 border-b border-default text-sm">
          <a href="#overview" aria-current="page" class="border-b-2 border-primary pb-2 font-medium text-highlighted">{{ t('projects.tabs.overview') }}</a>
          <a href="#milestones" class="pb-2 text-muted">{{ t('projects.tabs.milestones') }}</a>
        </nav>
      </template>
      <RecordSection id="overview" :title="t('projects.tabs.overview')" :description="t('projects.description')">
        <p class="text-sm text-default">{{ project.name }}</p>
      </RecordSection>
      <RecordSection id="milestones" :title="t('projects.tabs.milestones')">
        <template #actions><UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-plus">{{ t('app.create') }}</UButton></template>
        <p class="text-sm text-muted">{{ t('app.noResults') }}</p>
      </RecordSection>
      <template #aside>
        <PropertiesPanel :title="t('states.properties')">
          ${state.summary ? '' : `<PropertyRow :label="t('projects.columns.manager')" :value="project.manager?.name" />`}
          <PropertyRow :label="t('projects.columns.status')" :value="t('projects.status.' + project.status)" />
          <PropertyRow :label="t('projects.columns.progress')" :value="project.progress + '%'" />
          ${state.summary ? '' : `<PropertyRow :label="t('projects.columns.dateEnd')" :value="null" />`}
        </PropertiesPanel>
      </template>
    </RecordPage>
  </main>`,
})

export const Default: Story = { name: 'سجل مع خصائص', render: () => record() }
export const Loading: Story = { name: 'تحميل', render: () => record({ loading: true }) }
export const NotFound: Story = { name: 'غير موجود', render: () => record({ error: { status: 404 } }) }
export const ErrorState: Story = { name: 'خطأ', render: () => record({ error: { status: 500 } }) }
// The page supplies its own back control through the header's back slot; Escape still leaves for back-to.
export const WithBackSlot: Story = { name: 'خانة الرجوع', render: () => record({ backSlot: true }) }

export const OperationalSummary: Story = { name: 'ملخص تشغيلي قبل المحتوى', parameters: storyContext('apps/web/app/components/pmo/tasks/TaskDetailPanel.vue:99'), render: () => record({ summary: true }) }
