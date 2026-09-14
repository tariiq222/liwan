import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { TaskStateSchema } from '@nasq/contracts'
import StateBadge from '../../app/components/task/StateBadge.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Task/StateBadge',
  component: StateBadge,
  args: { state: 'in_progress' },
  argTypes: { state: { control: 'select', options: TaskStateSchema.options } },
  parameters: storyContext('apps/web/app/components/task/StateMenu.vue:34', 'يظهر للمهمة بلا انتقالات متاحة داخل صف المهمة `div.flex.flex-wrap.items-center.gap-2` من `apps/web/app/components/task/TaskTable.vue:231`، ضمن بطاقة الجوال التي تظهر فقط تحت 768px (`md:hidden`)، فالغلاف بعرض شاشة جوال 375px.'),
} satisfies Meta<typeof StateBadge>
export default meta
type Story = StoryObj<typeof meta>

export const InTaskRow: Story = {
  name: 'في صف المهمة',
  render: args => ({
    components: { StateBadge },
    setup: () => ({ args }),
    template: '<div style="width: 375px"><article class="space-y-3 p-4"><div class="flex flex-wrap items-center gap-2"><StateBadge v-bind="args" /></div></article></div>',
  }),
}

export const AllStates: Story = {
  name: 'كل الحالات',
  render: () => ({
    components: { StateBadge },
    setup: () => ({ states: TaskStateSchema.options }),
    template: '<div style="width: 375px"><article class="space-y-3 p-4"><div class="flex flex-wrap items-center gap-2"><StateBadge v-for="state in states" :key="state" :state="state" /></div></article></div>',
  }),
}
