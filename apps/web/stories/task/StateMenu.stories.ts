import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PrioritySelect from '../../app/components/task/PrioritySelect.vue'
import StateMenu from '../../app/components/task/StateMenu.vue'
import { makeTask } from '../fixtures/pmo'
import { transitionForbidden } from '../handlers/api'
import { storyContext } from '../support/context'

const meta = {
  title: 'Task/StateMenu',
  component: StateMenu,
  args: { task: makeTask() },
  parameters: storyContext('apps/web/app/components/task/TaskTable.vue:232', 'صف المهمة على الجوال تحت 768px، فالغلاف بعرض 375px.'),
  render: args => ({
    components: { PrioritySelect, StateMenu },
    setup: () => ({ args }),
    template: `<div class="divide-y divide-default" style="width: 375px"><article class="space-y-3 p-4"><div class="flex flex-wrap items-center gap-2"><StateMenu v-bind="args" /><PrioritySelect :task="args.task" /></div></article></div>`,
  }),
} satisfies Meta<typeof StateMenu>
export default meta
type Story = StoryObj<typeof meta>

export const InTaskRow: Story = { name: 'في صف المهمة' }
export const NoTransitions: Story = { name: 'بلا انتقالات متاحة', args: { task: makeTask({ state: 'done', is_closed: true, allowed_transitions: [] }) } }
export const TransitionForbidden: Story = {
  name: 'انتقال مرفوض',
  parameters: { msw: { handlers: { api: transitionForbidden } }, docs: { description: { story: 'اختر حالة لرؤية رسالة الرفض من الخادم.' } } },
}
