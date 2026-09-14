import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ChartContainer from '../../app/components/charts/ChartContainer.vue'
import DashboardChart from '../../app/components/shared/DashboardChart.client.vue'
import { dashboardCharts } from '../fixtures/projectReports'
import { storyContext } from '../support/context'

const meta = { title: 'Charts/ChartContainer', component: ChartContainer, args: { config: {} } } satisfies Meta<typeof ChartContainer>
export default meta

export const Default: StoryObj<typeof meta> = {
  name: 'عبر DashboardChart',
  parameters: storyContext('apps/web/app/components/shared/DashboardChart.client.vue:186', 'حاوية الرسم تتكرر مرتين داخل `DashboardChart` (دائري وأعمدة)، ولا تُستخدم خارجه. غيّر لون الهوية لرؤية `--chart-*` تتبدل.'),
  render: () => ({
    components: { DashboardChart },
    setup() {
      const { t } = useI18n()
      const charts = computed(() => dashboardCharts(t))
      return { charts, t }
    },
    template: `<div class="grid gap-5" style="grid-template-columns: repeat(2, minmax(0, 1fr))"><UCard class="min-w-0 overflow-hidden"><div class="min-w-0"><DashboardChart :chart="charts.budget" variant="donut" :accessible-label="t('projects.dashboard.charts.budgetHealthTitle')" height="240px" /></div></UCard><UCard class="min-w-0 overflow-hidden"><div class="min-w-0"><DashboardChart :chart="charts.progressBands" :accessible-label="t('projects.dashboard.charts.progressBandsTitle')" height="240px" /></div></UCard></div>`,
  }),
}
