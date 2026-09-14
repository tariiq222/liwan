import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AccessStateBadge from '../../app/components/access/AccessStateBadge.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Access/AccessStateBadge',
  component: AccessStateBadge,
  args: { active: true, protected: false, readOnly: false },
} satisfies Meta<typeof AccessStateBadge>
export default meta
type Story = StoryObj<typeof meta>

const cases = [
  { name: 'Admin', active: true, protected: true },
  { name: 'سارة القحطاني', active: true, protected: false },
  { name: 'محمد العتيبي', active: false, protected: false },
]

export const InTableCell: Story = {
  name: 'في خلية جدول المستخدمين',
  parameters: storyContext('apps/web/app/components/access/users/UserTable.vue:34'),
  render: () => ({
    components: { AccessStateBadge },
    setup: () => {
      const { t } = useI18n()
      return { data: cases, columns: [{ accessorKey: 'name', header: t('access.users.columns.name') }, { accessorKey: 'active', header: t('access.users.columns.status') }] }
    },
    template: `<div class="min-w-0 space-y-2"><UCard class="rounded-lg ring ring-default bg-default overflow-hidden hidden md:block" :ui="{ body: 'p-0' }"><div class="overflow-x-auto"><UTable :data="data" :columns="columns" :ui="{ caption: 'sr-only', th: '' }"><template #active-cell="{ row }"><AccessStateBadge :active="row.original.active" :protected="row.original.protected" /></template></UTable></div></UCard></div>`,
  }),
}

export const InMobileCard: Story = {
  name: 'في بطاقة الجوال',
  parameters: storyContext('apps/web/app/components/access/users/UserTable.vue:50', 'يظهر تحت 768px (md:hidden)، فالغلاف بعرض شاشة جوال 375px.'),
  render: args => ({
    components: { AccessStateBadge },
    setup: () => ({ args }),
    template: `<ul class="space-y-2" style="width: 375px"><li class="rounded-lg ring ring-default bg-default overflow-hidden p-4"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><bdi class="block text-xs text-muted">#7</bdi><p class="font-medium">سارة القحطاني</p></div><AccessStateBadge v-bind="args" /></div></li></ul>`,
  }),
}

export const ReadOnly: Story = { ...InMobileCard, name: 'للقراءة فقط', args: { active: true, readOnly: true } }
