import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import RowActions from '../../app/components/shared/RowActions.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/RowActions',
  component: RowActions,
  parameters: storyContext('apps/web/app/components/project/MilestoneTable.vue:183', 'إجراء واحد غير هدّام زر رابط، وأكثر من ذلك قائمة «…» والحذف آخرها باللون الهدّام.'),
  args: {
    label: 'إجراءات معلم اعتماد الخطة',
    actions: [
      { label: 'تحديد كمنجز', icon: 'i-lucide-circle-check', onSelect: fn() },
      { label: 'تعديل', icon: 'i-lucide-pencil', onSelect: fn() },
      { label: 'حذف', icon: 'i-lucide-trash-2', destructive: true, onSelect: fn() },
    ],
  },
  render: args => ({
    components: { RowActions },
    setup: () => ({ args }),
    template: '<div class="max-w-3xl rounded-lg ring ring-default bg-default"><div class="flex items-center justify-between gap-4 p-4"><div><p class="font-medium text-highlighted">اعتماد الخطة</p><p class="text-sm text-muted">الموعد 2026/10/01</p></div><RowActions v-bind="args" /></div></div>',
  }),
} satisfies Meta<typeof RowActions>
export default meta
type Story = StoryObj<typeof meta>

export const Menu: Story = { name: 'قائمة إجراءات' }
export const SingleAction: Story = { name: 'إجراء واحد', args: { label: 'إجراءات دور مدير النظام', actions: [{ label: 'عرض', to: '/settings/roles/1' }] } }
