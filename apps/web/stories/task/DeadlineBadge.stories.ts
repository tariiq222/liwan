import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DeadlineBadge from '../../app/components/task/DeadlineBadge.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Task/DeadlineBadge',
  component: DeadlineBadge,
  args: { deadline: '2026-09-15', daysRemaining: 2, isClosed: false },
  parameters: storyContext('apps/web/app/components/task/TaskCard.vue:88'),
} satisfies Meta<typeof DeadlineBadge>
export default meta
type Story = StoryObj<typeof meta>

export const OnTaskCard: Story = {
  name: 'على بطاقة المهمة',
  render: args => ({ components: { DeadlineBadge }, setup: () => ({ args }), template: '<div class="flex items-center gap-2"><DeadlineBadge v-bind="args" /></div>' }),
}

export const AllDeadlines: Story = {
  name: 'كل حالات الموعد',
  render: () => ({
    components: { DeadlineBadge },
    setup: () => ({
      cases: [
        { deadline: '2026-09-10', daysRemaining: -3, isClosed: false },
        { deadline: '2026-09-13', daysRemaining: 0, isClosed: false },
        { deadline: '2026-09-14', daysRemaining: 1, isClosed: false },
        { deadline: '2026-09-23', daysRemaining: 10, isClosed: false },
        { deadline: '2026-09-10', daysRemaining: -3, isClosed: true },
        { deadline: null, daysRemaining: null, isClosed: false },
      ],
    }),
    template: '<div class="flex flex-wrap items-center gap-2"><DeadlineBadge v-for="(item, index) in cases" :key="index" v-bind="item" /></div>',
  }),
}
