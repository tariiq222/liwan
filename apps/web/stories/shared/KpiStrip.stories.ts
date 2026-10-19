import type { Meta, StoryObj } from '@storybook/vue3-vite'
import KpiStrip from '@webvue/ui/app/components/shared/layout/KpiStrip.vue'
import { storyContext } from '../support/context'

const tiles = [
  { id: 'total', label: 'إجمالي المهام', icon: 'i-lucide-list-checks', tone: 'neutral', value: 128, hint: '22٪ منجزة', progress: 22 },
  { id: 'open', label: 'المهام المفتوحة', icon: 'i-lucide-clock', tone: 'warning', value: 82, hint: '64٪ من الإجمالي', progress: 64 },
  { id: 'overdue', label: 'المهام المتأخرة', icon: 'i-lucide-circle-alert', tone: 'danger', value: 18, hint: '14٪ من الإجمالي', progress: 14 },
  { id: 'done', label: 'المهام المنجزة', icon: 'i-lucide-circle-check', tone: 'success', value: 28, hint: '22٪ من الإجمالي', progress: 22 },
] as const

const meta = {
  title: 'Shared/KpiStrip',
  component: KpiStrip,
  parameters: storyContext('apps/web/app/components/pmo/tasks/TaskKpiStrip.vue:28', 'شريط المؤشرات فوق الصفحات الرئيسية وصفحات القوائم: بطاقات `SharedMetricTile` مدمجة (أربع في الصف من `lg`، واثنتان على الجوال). القيم أرقام ينسّقها المستدعي. يختفي كله حين يطفئ المستخدم المؤشرات بزر واحد في ترويسة الصفحة (`kpi-toggle` على `SharedPageHeader`)، ويُحفظ الاختيار في الكوكي `webvue-kpis`.'),
  args: { tiles: [...tiles] },
  render: args => ({
    components: { KpiStrip },
    setup: () => ({ args }),
    template: '<div class="max-w-5xl"><KpiStrip v-bind="args" /></div>',
  }),
} satisfies Meta<typeof KpiStrip>
export default meta
type Story = StoryObj<typeof meta>

export const FourTiles: Story = { name: 'أربع بطاقات' }
export const Loading: Story = { name: 'قيد التحميل', args: { tiles: [], loading: true } }
export const Hidden: Story = {
  name: 'مخفي (المؤشرات مطفأة)',
  parameters: { cookies: { 'webvue-kpis': 'hidden' } },
  render: () => ({ template: '<p class="text-sm text-muted">لا يظهر الشريط حين يكون الكوكي <code>webvue-kpis=hidden</code>؛ تبقى الصفحة بلا مؤشرات.</p>' }),
}
