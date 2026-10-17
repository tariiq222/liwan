import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PrioritySelect from '../../app/components/pmo/tasks/PrioritySelect.vue'
import StateMenu from '../../app/components/pmo/tasks/StateMenu.vue'
import { makeTask } from '../fixtures/pmo'
import { transitionForbidden } from '../handlers/api'
import { storyContext } from '../support/context'
import { useStoryTask } from '../support/taskCache'

const meta = {
  title: 'Task/StateMenu',
  component: StateMenu,
  args: { task: makeTask() },
  parameters: storyContext('apps/web/app/components/pmo/tasks/TaskTable.vue:131', 'صف المهمة على الجوال تحت 768px، فالغلاف بعرض 375px.'),
  render: args => ({
    components: { PrioritySelect, StateMenu },
    setup: () => ({ task: useStoryTask(() => args.task) }),
    template: `<div class="divide-y divide-default" style="width: 375px"><article class="space-y-3 p-4"><div class="flex flex-wrap items-center gap-2"><StateMenu :task="task" /><PrioritySelect :task="task" variant="badge" /></div></article></div>`,
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
