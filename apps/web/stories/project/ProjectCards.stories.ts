import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ProjectCards from '../../app/components/pmo/projects/ProjectCards.vue'
import ProjectTable from '../../app/components/pmo/projects/ProjectTable.vue'
import ListCard from '@webvue/ui/app/components/shared/layout/ListCard.vue'
import ListFooter from '@webvue/ui/app/components/shared/data/ListFooter.vue'
import { archivedProject, project } from '../fixtures/pmo'
import { storyContext } from '../support/context'

// One project per tone of the progress bar: late (danger), at risk (warning), finished (success), healthy (primary), unset.
const items = [
  { ...project, id: 11, name: 'مشروع متأخر عن موعده', status: 'off_track' as const, progress: 40, date_end: '2025-01-15' },
  { ...project, id: 12, name: 'مشروع معرض للخطر', status: 'at_risk' as const, progress: 62, date_end: '2099-06-30' },
  { ...project, id: 13, name: 'مشروع مكتمل', status: 'done' as const, progress: 100, task_count: 8, closed_task_count: 8, date_end: '2025-03-01' },
  { ...project, id: 14, name: 'مشروع على المسار بتقدم جيد واسم طويل يلتف على سطرين داخل البطاقة', status: 'on_track' as const, progress: 78, date_end: '2099-12-31' },
  { ...archivedProject, id: 15, name: 'مشروع بلا حالة ولا موعد', status: null, progress: 0, task_count: 0, closed_task_count: 0, date_end: null, can_manage: false },
]
const toFor = (p: { id: number }) => ({ path: `/projects/${p.id}` })

const meta = {
  title: 'Project/ProjectCards',
  component: ProjectCards,
  args: { items, isLoading: false, toFor },
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/projects/index.vue:336', 'عرض البطاقات داخل بطاقة القائمة. بدن مضغوط: الحالة والمرحلة ورقم السجل، ثم الاسم سطرًا واحدًا، ثم النسبة والبار وعدد المهام، ثم المدير وتاريخ الانتهاء. نبرة البار: خطر للمتأخر، تحذير للمعرض للخطر، نجاح للمكتمل، أساسي لغير ذلك.') },
  render: args => ({
    components: { ProjectCards, ListCard, ListFooter },
    setup: () => ({ args }),
    template: `<main class="webvue-shell-main"><ListCard><ProjectCards v-bind="args" /><template #footer><ListFooter :count-label="\`عرض \${args.items.length} من \${args.items.length}\`" :page="1" :pages="1" /></template></ListCard></main>`,
  }),
} satisfies Meta<typeof ProjectCards>
export default meta
type Story = StoryObj<typeof meta>

export const Cards: Story = { name: 'البطاقات' }
export const Loading: Story = { name: 'قيد التحميل', args: { isLoading: true } }

export const Table: Story = {
  name: 'عرض الجدول',
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/pages/projects/index.vue:336', 'الجدول بلا بطاقة خاصة داخل بطاقة القائمة، والتذييل فيه العدد والترقيم.') },
  render: args => ({
    components: { ProjectTable, ListCard, ListFooter },
    setup: () => ({ args }),
    template: `<main class="webvue-shell-main"><ListCard><ProjectTable v-bind="args" /><template #footer><ListFooter :count-label="\`عرض \${args.items.length} من \${args.items.length}\`" :page="1" :pages="1" /></template></ListCard></main>`,
  }),
}
