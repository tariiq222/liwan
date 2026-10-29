import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SettingsPage from '@webvue/ui/app/components/shared/layout/SettingsPage.vue'
import SettingsList from '@webvue/ui/app/components/shared/layout/SettingsList.vue'
import SettingsListRow from '@webvue/ui/app/components/shared/layout/SettingsListRow.vue'
import { storyContext } from '../support/context'

const rows = [
  { id: 1, name: 'السعر مرتفع', active: true, locked: false },
  { id: 2, name: 'اختار منافسًا', active: true, locked: false },
  { id: 3, name: 'لم يرد', active: false, locked: false },
  { id: 4, name: 'أخرى', active: true, locked: true },
]

const meta = {
  title: 'Shared/SettingsList',
  component: SettingsList,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('apps/web/app/components/crm/settings/CrmNamedListCard.vue:24', 'بطاقة قائمة قيم: كل صف يُحفظ وحده (إعادة تسمية في مكانه، أرشفة واستعادة)، ونموذج إضافة في الأسفل. القيم المحمية لا تُعدّل.'),
  },
  args: { id: 'lostReasons', title: 'أسباب الخسارة', description: 'تظهر عند إغلاق فرصة خاسرة.', canEdit: true, message: '', empty: false },
  render: args => ({
    components: { SettingsPage, SettingsList, SettingsListRow },
    setup: () => ({ args, rows }),
    template: `<main class="webvue-shell-main"><SettingsPage width="form"><SettingsList v-bind="args">
      <SettingsListRow v-for="row in rows" :key="row.id" :name="row.name" :active="row.active" :locked="row.locked" :can-edit="args.canEdit" />
      <template #add><UInput class="min-w-40 flex-1" placeholder="اسم جديد" aria-label="اسم جديد" /></template>
    </SettingsList></SettingsPage></main>`,
  }),
} satisfies Meta<typeof SettingsList>
export default meta
type Story = StoryObj<typeof meta>
export const Editable: Story = { name: 'قابلة للتعديل' }
export const ReadOnly: Story = { name: 'عرض فقط', args: { canEdit: false } }
export const SaveError: Story = { name: 'تعذّر الحفظ', args: { message: 'تعذّر حفظ التعديل' } }
export const Empty: Story = { name: 'فارغة', args: { empty: true } }
