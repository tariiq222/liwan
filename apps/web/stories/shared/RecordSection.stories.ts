import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import RecordSection from '../../app/components/shared/layout/RecordSection.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/RecordSection',
  component: RecordSection,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('unused', 'قسم بعنوان في العمود الرئيسي للسجل، مع إجراءاته بجانب العنوان.') },
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
    template: `<div class="max-w-2xl bg-muted p-4"><RecordSection panel id="milestones-panel" :title="t('projects.tabs.milestones')">
      <template #actions><UButton color="neutral" variant="outline" size="sm" icon="i-lucide-plus">{{ t('app.create') }}</UButton></template>
      <p class="text-sm text-muted">{{ t('app.noResults') }}</p>
    </RecordSection></div>`,
  }),
}
