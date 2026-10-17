import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import { fn } from 'storybook/test'
import TaskCard from '../../app/components/pmo/tasks/TaskCard.vue'
import { boardStages, makeTask } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const tasks = [
  makeTask(),
  makeTask({ id: 102, name: 'مراجعة عقد المورد مع الإدارة القانونية قبل التوقيع النهائي', priority: '3', date_deadline: '2026-09-10', days_remaining: -3, is_overdue: true, tags: [] }),
  makeTask({ id: 103, name: 'تحديث سجل المخاطر', state: 'done', is_closed: true, priority: '0', date_deadline: null, days_remaining: null, assignees: [{ id: 9, name: 'محمد العتيبي' }], allowed_transitions: [] }),
]

// The board's list payload carries no subtasks or attachments; a task detail does, and the card then shows both rows.
const subtask = (id: number, state: 'in_progress' | 'done' | 'cancelled') => makeTask({ id, name: `مهمة فرعية ${id}`, state, is_closed: state !== 'in_progress' })
const richTask = {
  ...makeTask({ id: 104, name: 'إعداد خطة الإطلاق التجريبي وتنسيق الفرق المعنية قبل نهاية الأسبوع', priority: '3', date_deadline: '2026-09-10', days_remaining: -3, is_overdue: true, assignees: [{ id: 2, name: 'Admin' }, { id: 7, name: 'سارة القحطاني' }, { id: 9, name: 'محمد العتيبي' }, { id: 11, name: 'فاطمة الزهراني' }] }),
  subtasks: [subtask(201, 'done'), subtask(202, 'done'), subtask(203, 'cancelled'), subtask(204, 'in_progress')],
  attachments: [{ id: 1, name: 'a.pdf', mimetype: 'application/pdf', url: '/web/content/1' }, { id: 2, name: 'b.png', mimetype: 'image/png', url: '/web/content/2' }],
}
const noDeadline = makeTask({ id: 105, name: 'مهمة بلا موعد', priority: '0', date_deadline: null, days_remaining: null, assignees: [] })

const meta = {
  title: 'Task/TaskCard',
  component: TaskCard,
  args: { task: tasks[0]!, stages: boardStages, currentStageId: 11, showProject: true, onOpen: fn(), onMove: fn() },
  parameters: storyContext('apps/web/app/components/pmo/tasks/TaskBoard.vue:277', 'عمود اللوحة `w-72 p-2 border` من `apps/web/app/components/pmo/tasks/TaskBoard.vue:277`؛ بطاقة لكل مهمة.'),
} satisfies Meta<typeof TaskCard>
export default meta
type Story = StoryObj<typeof meta>

export const InBoardColumn: Story = {
  name: 'داخل عمود اللوحة',
  render: args => ({
    components: { TaskCard },
    setup: () => ({ args, tasks, stageName: computed(() => args.stages.find(stage => stage.id === args.currentStageId)?.name ?? '') }),
    template: `<div class="flex h-full w-72 shrink-0 flex-col gap-2 rounded-control border border-default bg-elevated/30 p-2"><div class="flex items-center justify-between px-1"><h3 class="text-sm font-medium text-muted">{{ stageName }}</h3><span class="text-xs text-muted">{{ tasks.length }}</span></div><div class="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto"><TaskCard v-for="task in tasks" :key="task.id" :task="task" :stages="args.stages" :current-stage-id="args.currentStageId" :show-project="args.showProject" @open="args.onOpen" @move="args.onMove" /></div></div>`,
  }),
}

export const ProjectBoard: Story = { ...InBoardColumn, name: 'في لوحة المشروع (بلا اسم المشروع)', args: { showProject: false } }

export const RichCard: Story = {
  name: 'بطاقة غنية (فرعية ومرفقات وكومة مسؤولين)',
  render: args => ({
    components: { TaskCard },
    setup: () => ({ args, richTask, noDeadline }),
    template: '<div class="flex w-[21.4286rem] flex-col gap-2.5 rounded-card bg-muted p-2.5"><TaskCard :task="richTask" :stages="args.stages" :current-stage-id="args.currentStageId" /><TaskCard :task="noDeadline" :stages="args.stages" :show-project="false" /></div>',
  }),
}
