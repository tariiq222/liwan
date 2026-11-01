import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import DashboardChart from '../../app/components/shared/data/DashboardChart.client.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import type { DashboardChart as DashboardChartModel } from '../../app/utils/projectChartData'
import { dashboardCharts } from '../fixtures/projectReports'
import { storyContext } from '../support/context'

const emptyChart: DashboardChartModel = { kind: 'donut', data: [], palette: 'primary', total: 0, centerLabel: '', centerSubLabel: '' }

const meta = {
  title: 'Shared/DashboardChart',
  component: DashboardChart,
  parameters: { layout: 'fullscreen' },
  args: { chart: emptyChart, accessibleLabel: '' },
} satisfies Meta<typeof DashboardChart>
export default meta
type Story = StoryObj<typeof meta>

export const FinanceComparison: Story = {
  name: 'المخطط مقابل الفعلي',
  parameters: storyContext('apps/web/app/components/pmo/projects/dashboard/ProjectDashboardCharts.vue:126', 'بطاقة المالية عريضة داخل شبكة لوحة المشاريع؛ الاستخدام الآخر داخل `DashboardChartPanel` له قصصه.'),
  render: () => ({
    components: { DashboardChart, PageContainer },
    setup() {
      const { t } = useI18n()
      return { chart: computed(() => dashboardCharts(t).finance), t }
    },
    template: `<main class="liwan-shell-main"><PageContainer width="list"><div class="min-w-0" style="container-type: inline-size"><div class="min-w-0" style="display: grid; gap: 1.25rem; grid-template-columns: repeat(2, minmax(0, 1fr))"><UCard class="min-w-0 overflow-hidden" style="grid-column: span 2"><template #header><h2 class="text-lg font-semibold leading-6 text-highlighted">{{ t('projects.dashboard.charts.financeTitle') }}</h2></template><div class="min-w-0"><DashboardChart :chart="chart" :accessible-label="t('projects.dashboard.charts.financeTitle')" height="360px" /></div></UCard></div></div></PageContainer></main>`,
  }),
}

const day = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)
const plannedCurve: DashboardChartModel = {
  kind: 'line',
  series: { key: 'pv', label: 'المخططة' },
  seriesDisplay: '60000.00 ر.س',
  data: [['2026-03-01', 0], ['2026-03-08', 12000], ['2026-03-15', 60000], ['2026-03-22', 96000], ['2026-03-29', 114000], ['2026-03-30', 120000]].map(([date, y]) => ({ x: day(date as string), y: y as number })),
  markers: [
    { key: 'ev', label: 'المكتسبة', display: '42000.00 ر.س', x: day('2026-03-15'), y: 42000, tone: 'success' },
    { key: 'ac', label: 'الفعلية', display: '48000.00 ر.س', x: day('2026-03-15'), y: 48000, tone: 'warning' },
  ],
}

export const LineWithMarkers: Story = {
  name: 'خط مع نقاط (القيمة المخططة والمكتسبة)',
  parameters: storyContext('apps/web/app/pages/projects/[id]/evm.vue:48', 'منحنى القيمة المخططة من خط الأساس على محور زمني، مع نقطتين لليوم هما القيمة المكتسبة والتكلفة الفعلية. صندوق الرسم LTR دائمًا والمفتاح تحته يتبع اتجاه الصفحة.'),
  render: () => ({
    components: { DashboardChart, PageContainer },
    template: `<main class="liwan-shell-main"><PageContainer width="list"><UCard class="min-w-0 overflow-hidden"><DashboardChart :chart="chart" accessible-label="مخطط القيمة المخططة" height="300px" /></UCard></PageContainer></main>`,
    setup: () => ({ chart: plannedCurve }),
  }),
}
