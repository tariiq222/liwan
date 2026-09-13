import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import RecordNumber from '../../app/components/shared/RecordNumber.vue'
import { storyContext } from '../support/context'

const rows = [{ id: 1042, name: 'وزارة التخطيط' }, { id: 7, name: 'فريق الجودة' }]

const meta = {
  title: 'Shared/RecordNumber',
  component: RecordNumber,
  args: { value: 1042 },
} satisfies Meta<typeof RecordNumber>
export default meta
type Story = StoryObj<typeof meta>

export const InTableCell: Story = {
  name: 'داخل خلية جدول',
  parameters: storyContext('apps/web/app/pages/projects/[id]/stakeholders/index.vue:107'),
  render: () => ({
    components: { RecordNumber },
    setup() {
      const { t } = useI18n()
      const columns = computed(() => [{ accessorKey: 'id', header: '#' }, { accessorKey: 'name', header: t('projects.governance.stakeholders') }])
      return { rows, columns }
    },
    template: `<section class="nasq-ui-record-surface"><div class="min-w-0 overflow-x-auto"><UTable :data="rows" :columns="columns"><template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template></UTable></div></section>`,
  }),
}

export const InMobileCard: Story = {
  name: 'داخل بطاقة الجوال',
  parameters: storyContext('apps/web/app/pages/projects/[id]/stakeholders/index.vue:149', 'تظهر البطاقة تحت 768px (md:hidden)، فالغلاف بعرض شاشة جوال 375px.'),
  render: args => ({
    components: { RecordNumber },
    setup: () => ({ args }),
    template: `<ul class="grid gap-3 p-3" style="width: 375px"><li><UCard><div class="space-y-3"><div class="flex items-start justify-between gap-3"><div class="min-w-0 space-y-1"><RecordNumber v-bind="args" /><span class="block font-medium">وزارة التخطيط</span></div></div></div></UCard></li></ul>`,
  }),
}

export const EmptyValue: Story = { ...InMobileCard, name: 'بدون رقم', args: { value: null } }
