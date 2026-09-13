import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PrioritySelect from '../../app/components/task/PrioritySelect.vue'
import StateMenu from '../../app/components/task/StateMenu.vue'
import { makeTask } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const meta = {
  title: 'Task/PrioritySelect',
  component: PrioritySelect,
  args: { task: makeTask() },
  parameters: storyContext('apps/web/app/components/task/TaskTable.vue:233', 'صف المهمة على الجوال تحت 768px، فالغلاف بعرض 375px. التغيير يرسل PATCH إلى MSW.'),
  render: args => ({
    components: { PrioritySelect, StateMenu },
    setup: () => ({ args }),
    template: `<div class="divide-y divide-default" style="width: 375px"><article class="space-y-3 p-4"><div class="flex flex-wrap items-center gap-2"><StateMenu :task="args.task" /><PrioritySelect v-bind="args" /></div></article></div>`,
  }),
} satisfies Meta<typeof PrioritySelect>
export default meta
type Story = StoryObj<typeof meta>

export const InTaskRow: Story = { name: 'في صف المهمة' }
export const ReadOnly: Story = { name: 'بلا صلاحية تعديل', args: { task: makeTask({ can_write: false }) } }
