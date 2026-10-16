import type { Meta, StoryObj } from '@storybook/vue3-vite'
import MyTaskRow from '../../app/components/personal-tasks/MyTaskRow.vue'
import { storyContext } from '../support/context'

const task = { id: 7, name: 'متابعة طلب الأدوات', state: 'open' as const, priority: 'high' as const, date_deadline: '2026-10-01T00:00:00Z', assignees: [{ id: 2, name: 'أحمد', user_id: 2 }], source: 'personal' as const, project: null, href: '/my-tasks/7' }
const meta = {
  title: 'MyTasks/MyTaskRow', component: MyTaskRow,
  parameters: storyContext('apps/web/app/pages/my-tasks/index.vue:212', 'صفوف مهامي، مع المصدر والموعد وحالة التأخر نصًا.'),
  args: { task, to: '/my-tasks/7', today: '2026-10-15', part: 'card' },
  render: args => ({ components: { MyTaskRow }, setup: () => ({ args }), template: '<div class="max-w-xl"><MyTaskRow v-bind="args" /></div>' }),
} satisfies Meta<typeof MyTaskRow>
export default meta
type Story = StoryObj<typeof meta>
export const Personal: Story = { name: 'مهمة شخصية متأخرة' }
export const Project: Story = { name: 'مهمة من مشروع', args: { task: { ...task, source: 'project', project: { id: 1, name: 'المشروع' }, href: '/projects/1/tasks/7' } } }
export const Closed: Story = { name: 'مهمة ملغاة', args: { task: { ...task, state: 'cancelled' } } }

export const Cards: Story = {
  name: 'شبكة كروت المهام',
  render: args => ({
    components: { MyTaskRow },
    setup: () => ({ args, tasks: [task, { ...task, id: 8, name: 'مراجعة العقد مع فريق المشروع', source: 'project', project: { id: 1, name: 'مشروع الأفق' }, href: '/projects/1/tasks/8', priority: 'normal' }, { ...task, id: 9, name: 'ترتيب الملفات', state: 'done', date_deadline: null }] }),
    template: `<ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><li v-for="item in tasks" :key="item.id" class="min-w-0 rounded-lg bg-default p-4 ring ring-default"><MyTaskRow v-bind="args" :task="item" :to="item.href" part="card" /></li></ul>`,
  }),
}
