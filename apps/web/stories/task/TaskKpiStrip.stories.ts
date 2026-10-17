import type { Meta, StoryObj } from '@storybook/vue3-vite'
import TaskKpiStrip from '../../app/components/pmo/tasks/TaskKpiStrip.vue'
import { storyContext } from '../support/context'

// The strip reads GET /api/v1/tasks/summary, answered by the MSW handler in stories/handlers/api.ts.
const meta = {
  title: 'Task/TaskKpiStrip',
  component: TaskKpiStrip,
  parameters: storyContext('apps/web/app/pages/tasks.vue:77', 'أربع بطاقات مدمجة فوق جدول المهام: الإجمالي والمفتوحة والمتأخرة (الرقم والأيقونة بالأحمر فقط) والمنجزة. ليست أزرارًا ولا تحمل اتجاهات.'),
  args: { params: { closed: false } },
  render: args => ({
    components: { TaskKpiStrip },
    setup: () => ({ args }),
    template: '<div class="max-w-5xl"><TaskKpiStrip v-bind="args" /></div>',
  }),
} satisfies Meta<typeof TaskKpiStrip>
export default meta
type Story = StoryObj<typeof meta>

export const AboveTaskTable: Story = { name: 'فوق جدول المهام' }
