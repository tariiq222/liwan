import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SettingsPreviewCard from '../../app/components/settings/SettingsPreviewCard.vue'
import SettingsPreviewList from '../../app/components/settings/SettingsPreviewList.vue'
import { storyContext } from '../support/context'
import { previewRows } from './fixtures'

const meta = {
  title: 'Settings/SettingsPreviewCard', component: SettingsPreviewCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/team/index.vue:29', 'بطاقة معاينة لقائمة طويلة في صفحة إعدادات: آخر خمسة صفوف بلا فلاتر وذيلها رابط «الكل» إلى صفحة القائمة الكاملة.') },
  args: { title: 'المستخدمون', allLabel: 'كل المستخدمين', allTo: '/settings/team/users' },
  render: args => ({ components: { SettingsPreviewCard, SettingsPreviewList }, setup: () => ({ args, rows: previewRows.slice(0, 3) }), template: '<div class="max-w-lg"><SettingsPreviewCard v-bind="args"><SettingsPreviewList :items="rows" empty-text="لا توجد سجلات بعد" /></SettingsPreviewCard></div>' }),
} satisfies Meta<typeof SettingsPreviewCard>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'معاينة' }
export const Empty: Story = {
  name: 'فارغة',
  render: args => ({ components: { SettingsPreviewCard, SettingsPreviewList }, setup: () => ({ args }), template: '<div class="max-w-lg"><SettingsPreviewCard v-bind="args"><SettingsPreviewList :items="[]" empty-text="لا توجد سجلات بعد" /></SettingsPreviewCard></div>' }),
}
