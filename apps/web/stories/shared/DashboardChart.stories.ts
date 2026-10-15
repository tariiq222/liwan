import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import DashboardChart from '../../app/components/shared/data/DashboardChart.client.vue'
import PageContainer from '../../app/components/shared/layout/PageContainer.vue'
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
  parameters: storyContext('apps/web/app/components/pmo/projects/dashboard/ProjectDashboardCharts.vue:124', 'بطاقة المالية عريضة داخل شبكة لوحة المشاريع؛ الاستخدام الآخر داخل `DashboardChartPanel` له قصصه.'),
  render: () => ({
    components: { DashboardChart, PageContainer },
    setup() {
      const { t } = useI18n()
      return { chart: computed(() => dashboardCharts(t).finance), t }
    },
    template: `<main class="nasq-shell-main"><PageContainer width="list"><div class="min-w-0" style="container-type: inline-size"><div class="min-w-0" style="display: grid; gap: 1.25rem; grid-template-columns: repeat(2, minmax(0, 1fr))"><UCard class="min-w-0 overflow-hidden" style="grid-column: span 2"><template #header><h2 class="text-lg font-semibold leading-6 text-highlighted">{{ t('projects.dashboard.charts.financeTitle') }}</h2></template><div class="min-w-0"><DashboardChart :chart="chart" :accessible-label="t('projects.dashboard.charts.financeTitle')" height="360px" /></div></UCard></div></div></PageContainer></main>`,
  }),
}
