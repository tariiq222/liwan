import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SettingsPreviewList from '../../app/components/settings/SettingsPreviewList.vue'
import { storyContext } from '../support/context'
import { previewRows } from './fixtures'

const meta = {
  title: 'Settings/SettingsPreviewList', component: SettingsPreviewList,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/settings/team/index.vue:35', 'أسطر المعاينة مع حالات التحميل والخطأ والفراغ المشتركة.') },
  args: { items: previewRows, emptyText: 'لا توجد سجلات بعد' },
  render: args => ({ components: { SettingsPreviewList }, setup: () => ({ args }), template: '<div class="max-w-md rounded-card bg-default ring ring-default"><SettingsPreviewList v-bind="args" /></div>' }),
} satisfies Meta<typeof SettingsPreviewList>
export default meta
type Story = StoryObj<typeof meta>

export const Rows: Story = { name: 'أسطر' }
export const Loading: Story = { name: 'تحميل', args: { items: [], loading: true } }
export const Empty: Story = { name: 'فارغة', args: { items: [] } }
export const Failed: Story = { name: 'تعذر التحميل', args: { items: [], error: new Error('تعذر تحميل السجلات') } }
