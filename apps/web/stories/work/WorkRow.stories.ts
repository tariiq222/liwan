import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WorkRow from '../../app/components/work/WorkRow.vue'
import { storyContext } from '../support/context'

const row = { id: 'tasks-due:task-1', label: 'تقرير الربع الثالث', to: '/my-tasks/1', caption: 'متأخرة', tone: 'urgent' as const, module: 'tasks', work: 'execute' as const, suggestion: 'ابدأ بالمهمة المتأخرة.' }
const meta = {
  title: 'Work/WorkRow',
  component: WorkRow,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/work.vue:70', 'صف في «مهامي» و«ابدأ بالأهم»: الرابط، التطبيق المصدر، السطر الوصفي، واقتراح نصي فقط. العاجل بنقطة دافئة وشارة «عاجل».') },
  args: { row, sourceLabel: 'مهامي' },
  render: args => ({ components: { WorkRow }, setup: () => ({ args }), template: '<ul class="max-w-xl rounded-card bg-default ring ring-default"><WorkRow v-bind="args" /></ul>' }),
} satisfies Meta<typeof WorkRow>
export default meta
type Story = StoryObj<typeof meta>
export const Urgent: Story = { name: 'عاجل مع اقتراح' }
export const Normal: Story = { name: 'عادي', args: { row: { ...row, tone: 'normal', caption: 'تستحق اليوم', suggestion: undefined } } }
