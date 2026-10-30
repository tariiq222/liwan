import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import RecordPage from '@liwan/ui/app/components/shared/layout/RecordPage.vue'
import RecordSection from '@liwan/ui/app/components/shared/layout/RecordSection.vue'
import PropertiesPanel from '@liwan/ui/app/components/shared/layout/PropertiesPanel.vue'
import PropertyRow from '@liwan/ui/app/components/shared/layout/PropertyRow.vue'
import EmptyState from '@liwan/ui/app/components/shared/feedback/EmptyState.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'MyTasks/MyTaskRecord', component: RecordPage,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/my-tasks/[id]/index.vue:148', 'توزيع سجل مهامي على القوالب المشتركة: ملخص قرار، وصف ومتابعة، ثم معلومات التوثيق. بيانات قصة ثابتة بلا طلبات API.') },
  args: { title: 'متابعة التوريد', backTo: '/my-tasks' },
  render: args => ({
    components: { RecordPage, RecordSection, PropertiesPanel, PropertyRow, EmptyState },
    setup: () => ({ args, t: useI18n().t }),
    template: `<RecordPage v-bind="args" :back-label="t('myTasks.detail.back')">
      <template #summary><PropertiesPanel>
        <PropertyRow :label="t('myTasks.detail.deadline')" value="2026-10-20" />
        <PropertyRow :label="t('myTasks.detail.priority')" :value="t('myTasks.priority.normal')" />
        <PropertyRow :label="t('myTasks.detail.assignees')" value="أحمد" />
      </PropertiesPanel></template>
      <RecordSection variant="panel" :title="t('myTasks.detail.description')"><p>{{ t('myTasks.detail.noDescription') }}</p></RecordSection>
      <RecordSection variant="panel" :title="t('myTasks.subtasks.title')"><EmptyState :title="t('myTasks.subtasks.empty')" /></RecordSection>
      <RecordSection variant="panel" :title="t('myTasks.attachments.title')"><EmptyState :title="t('myTasks.attachments.empty')" /></RecordSection>
      <RecordSection variant="panel" :title="t('myTasks.comments.title')"><EmptyState :title="t('myTasks.comments.empty')" /></RecordSection>
      <RecordSection variant="tinted" :title="t('myTasks.detail.info')"><PropertiesPanel>
        <PropertyRow :label="t('myTasks.detail.creator')" value="أحمد" />
        <PropertyRow :label="t('myTasks.detail.createdAt')" value="2026-10-15" />
      </PropertiesPanel></RecordSection>
    </RecordPage>`,
  }),
} satisfies Meta<typeof RecordPage>
export default meta
type Story = StoryObj<typeof meta>
export const Open: Story = { name: 'سجل مهمة' }
export const Pending: Story = { name: 'أثناء التحميل', args: { loading: true, title: '' } }
