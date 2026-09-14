import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import TaskProperties from '../../app/components/task/TaskProperties.vue'
import { makeTask, taskDetail } from '../fixtures/pmo'
import { storyContext } from '../support/context'
import { useStoryTask } from '../support/taskCache'

const meta = {
  title: 'Task/TaskProperties',
  component: TaskProperties,
  args: { task: taskDetail({ ...makeTask() }) },
  parameters: storyContext('apps/web/app/components/task/TaskDetailPanel.vue:251', 'عمود الخصائص في سجل المهمة (`aside.nasq-record-aside`، 300px على ≥1024px). كل تغيير يرسل PATCH إلى MSW.'),
  render: args => ({
    components: { TaskProperties },
    setup: () => {
      const cached = useStoryTask(() => args.task)
      return { task: computed(() => taskDetail({ ...cached.value })) }
    },
    template: `<div class="nasq-record-grid"><div class="nasq-record-main"><div class="nasq-ui-record-surface min-h-64 p-4 text-sm text-muted">{{ $t('tasks.drawer.description') }}</div></div><aside class="nasq-record-aside"><TaskProperties :task="task" /></aside></div>`,
  }),
} satisfies Meta<typeof TaskProperties>
export default meta
type Story = StoryObj<typeof meta>

export const InRecordAside: Story = { name: 'في عمود خصائص السجل' }
export const ReadOnly: Story = { name: 'بلا صلاحية تعديل', args: { task: taskDetail({ ...makeTask({ can_write: false }) }) } }
