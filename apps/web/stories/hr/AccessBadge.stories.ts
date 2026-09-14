import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { HrEmployeeAccessSchema } from '@nasq/contracts'
import AccessBadge from '../../app/components/hr/AccessBadge.vue'
import { storyContext } from '../support/context'

const accesses = [
  null,
  HrEmployeeAccessSchema.parse({ user_id: 7, login: 'sara', role: 'employee', active: true }),
  HrEmployeeAccessSchema.parse({ user_id: 2, login: 'admin', role: 'admin', active: true }),
  HrEmployeeAccessSchema.parse({ user_id: 5, login: 'vendor', role: 'vendor', active: true }),
  HrEmployeeAccessSchema.parse({ user_id: 9, login: 'mohammed', role: 'employee', active: false }),
]

const meta = {
  title: 'HR/AccessBadge',
  component: AccessBadge,
  args: { access: accesses[1]! },
  parameters: storyContext('apps/web/app/components/hr/DirectoryTable.vue:192', 'بطاقة الدليل على الجوال تحت 768px، فالغلاف بعرض 375px.'),
} satisfies Meta<typeof AccessBadge>
export default meta
type Story = StoryObj<typeof meta>

export const InDirectoryCard: Story = {
  name: 'في بطاقة الدليل',
  render: args => ({
    components: { AccessBadge },
    setup: () => ({ args }),
    template: `<ul style="width: 375px"><li class="nasq-ui-record-surface p-4"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><bdi class="block text-xs text-muted">#7</bdi><a class="font-medium hover:underline">سارة القحطاني</a></div><AccessBadge v-bind="args" /></div></li></ul>`,
  }),
}

export const AllAccess: Story = {
  name: 'كل حالات الحساب',
  render: () => ({
    components: { AccessBadge },
    setup: () => ({ accesses }),
    template: `<ul style="width: 375px" class="space-y-2"><li v-for="(access, index) in accesses" :key="index" class="nasq-ui-record-surface p-4"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><bdi class="block text-xs text-muted">#{{ index }}</bdi><a class="font-medium hover:underline">مستخدم {{ index }}</a></div><AccessBadge :access="access" /></div></li></ul>`,
  }),
}
