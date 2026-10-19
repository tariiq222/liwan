import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ProjectKpiStrip from '../../app/components/pmo/projects/ProjectKpiStrip.vue'
import { storyContext } from '../support/context'

// The strip reads GET /api/v1/reports/projects/summary, answered by the MSW handler in stories/handlers/api.ts.
const meta = {
  title: 'Project/ProjectKpiStrip',
  component: ProjectKpiStrip,
  parameters: storyContext('apps/web/app/pages/projects/index.vue:276', 'أربع بطاقات مدمجة فوق قائمة المشاريع بنفس شريط مؤشرات المهام: الإجمالي والجارية وتحتاج متابعة (الرقم والأيقونة بالأحمر فقط) والمنجزة، لفلاتر القائمة نفسها. كل بطاقة بشريط تقدم رفيع بلون نبرتها، وبطاقة الإجمالي تعرض نسبة المنجز. ليست أزرارًا.'),
  args: { filters: {} },
  render: args => ({
    components: { ProjectKpiStrip },
    setup: () => ({ args }),
    template: '<div class="max-w-5xl"><ProjectKpiStrip v-bind="args" /></div>',
  }),
} satisfies Meta<typeof ProjectKpiStrip>
export default meta
type Story = StoryObj<typeof meta>

export const AboveProjectList: Story = { name: 'فوق قائمة المشاريع' }
export const StatusFilterCountsOnly: Story = { name: 'فلتر حالة: أرقام فقط', args: { filters: { status: 'at_risk' } } }
