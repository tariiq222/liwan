import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import RecordSection from '@webvue/ui/app/components/shared/layout/RecordSection.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/RecordSection',
  component: RecordSection,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('unused', 'قسم بعنوان في العمود الرئيسي للسجل، مع إجراءاته بجانب العنوان. `variant`: `flat` (الافتراضي بلا بطاقة)، `panel` بطاقة، `list` بطاقة بجسم بلا حشوة وصفوف مفصولة، `tinted` معلومة ثانوية، `action` الإجراء الوحيد المطلوب في الصفحة.') },
} satisfies Meta<typeof RecordSection>
export default meta
type Story = StoryObj

export const WithActions: Story = {
  name: 'قسم بإجراء',
  render: () => ({
    components: { RecordSection },
    setup: () => ({ t: useI18n().t }),
    template: `<div class="max-w-2xl"><RecordSection id="milestones" :title="t('projects.tabs.milestones')" :description="t('projects.description')">
      <template #actions><UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-plus">{{ t('app.create') }}</UButton></template>
      <p class="text-sm text-muted">{{ t('app.noResults') }}</p>
    </RecordSection></div>`,
  }),
}

export const Panel: Story = {
  name: 'بطاقة بعنوان وإجراء',
  render: () => ({
    components: { RecordSection },
    setup: () => ({ t: useI18n().t }),
    template: `<div class="max-w-2xl bg-muted p-4"><RecordSection variant="panel" id="milestones-panel" :title="t('projects.tabs.milestones')">
      <template #actions><UButton color="neutral" variant="outline" size="sm" icon="i-lucide-plus">{{ t('app.create') }}</UButton></template>
      <p class="text-sm text-muted">{{ t('app.noResults') }}</p>
    </RecordSection></div>`,
  }),
}

const row = (text: string) => `<p class="px-(--webvue-card-pad) py-3 text-sm">${text}</p>`

export const Variants: Story = {
  name: 'الأنواع الخمسة',
  render: () => ({
    components: { RecordSection },
    setup: () => ({ t: useI18n().t }),
    template: `<div class="grid max-w-2xl gap-(--webvue-gap-card) bg-muted p-4">
      <RecordSection variant="flat" :title="t('projects.tabs.milestones')"><p class="text-sm text-muted">{{ t('app.noResults') }}</p></RecordSection>
      <RecordSection variant="panel" :title="t('projects.tabs.milestones')"><p class="text-sm text-muted">{{ t('app.noResults') }}</p></RecordSection>
      <RecordSection variant="list" :title="t('projects.tabs.milestones')">${row('{{ t(\'projects.tabs.milestones\') }}')}${row('{{ t(\'projects.tabs.milestones\') }}')}</RecordSection>
      <RecordSection variant="tinted" :title="t('projects.tabs.milestones')"><p class="text-sm text-muted">{{ t('app.noResults') }}</p></RecordSection>
      <RecordSection variant="action" :title="t('projects.tabs.milestones')" :description="t('projects.description')">
        <template #actions><UButton size="sm" icon="i-lucide-check">{{ t('app.create') }}</UButton></template>
      </RecordSection>
    </div>`,
  }),
}
