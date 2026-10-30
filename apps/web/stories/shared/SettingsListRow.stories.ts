import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SettingsListRow from '@liwan/ui/app/components/shared/layout/SettingsListRow.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/SettingsListRow',
  component: SettingsListRow,
  parameters: {
    a11y: { test: 'error' },
    ...storyContext('apps/web/app/components/crm/settings/CrmStageListCard.vue:50', 'صف في بطاقة قائمة قيم: الاسم يُعدّل في مكانه، وعناصر الصف الخاصة في الفتحة، ثم الحالة وزر الأرشفة أو الاستعادة.'),
  },
  args: { name: 'تم التواصل', active: true, locked: false, canEdit: true },
  render: args => ({
    components: { SettingsListRow },
    setup: () => ({ args }),
    template: `<ul class="grid gap-2 p-4"><SettingsListRow v-bind="args"><UFormField orientation="horizontal" label="تم البيع"><USwitch :model-value="false" aria-label="تم البيع" :disabled="!args.canEdit" /></UFormField></SettingsListRow></ul>`,
  }),
} satisfies Meta<typeof SettingsListRow>
export default meta
type Story = StoryObj<typeof meta>
export const Active: Story = { name: 'نشط' }
export const Archived: Story = { name: 'مؤرشف', args: { active: false } }
export const Protected: Story = { name: 'محمي', args: { locked: true } }
export const ReadOnly: Story = { name: 'عرض فقط', args: { canEdit: false } }
