import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SettingsPreviewRow from '../../app/components/settings/SettingsPreviewRow.vue'
import { storyContext } from '../support/context'
import { previewRows } from './fixtures'

const meta = {
  title: 'Settings/SettingsPreviewRow', component: SettingsPreviewRow,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/settings/SettingsPreviewList.vue:13', 'سطر معاينة مدمج لا جدول: رقاقة أو صورة شخص، الاسم 14px/600 في سطر واحد مقتطع، سطر ثانوي خافت، وحبّة حالة واحدة على الأكثر. لا تمرير أفقي بأي عرض.') },
  render: args => ({ components: { SettingsPreviewRow }, setup: () => ({ args }), template: '<ul class="max-w-md divide-y divide-default rounded-card bg-default ring ring-default"><li><SettingsPreviewRow v-bind="args" /></li></ul>' }),
} satisfies Meta<typeof SettingsPreviewRow>
export default meta
type Story = StoryObj<typeof meta>

export const Person: Story = { name: 'شخص', args: { item: previewRows[0]! } }
export const Icon: Story = { name: 'أيقونة', args: { item: previewRows[2]! } }
export const WithoutBadge: Story = { name: 'بلا حبّة', args: { item: previewRows[3]! } }
export const LongText: Story = {
  name: 'نص طويل يُقتطع',
  args: { item: { ...previewRows[2]!, name: 'مراجع المشاريع والتقارير المالية والموارد البشرية للفروع كلها', secondary: 'وصف طويل جدًا للدور يمتد أكثر من عرض البطاقة ويجب أن يُقتطع بدل أن يسبب تمريرًا أفقيًا · المستخدمون: 120' } },
}
