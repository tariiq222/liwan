import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import DashboardChartPanel from '../../../app/components/pmo/projects/dashboard/DashboardChartPanel.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import type { DashboardChart } from '../../../app/utils/projectChartData'
import { dashboardCharts } from '../../fixtures/projectReports'
import { storyContext } from '../../support/context'

const emptyChart: DashboardChart = { kind: 'donut', data: [], palette: 'primary', total: 0, centerLabel: '', centerSubLabel: '' }

const meta = {
  title: 'Project/DashboardChartPanel',
  component: DashboardChartPanel,
  parameters: { layout: 'fullscreen' },
  args: { testId: 'story', title: '', description: '', chart: emptyChart, hasData: true, emptyText: '', accessibleLabel: '' },
} satisfies Meta<typeof DashboardChartPanel>
export default meta
type Story = StoryObj<typeof meta>

type ChartKey = keyof ReturnType<typeof dashboardCharts>
const GRID = 'display: grid; gap: var(--liwan-gap-card); grid-template-columns: repeat(2, minmax(0, 1fr));'

function panel(key: ChartKey, title: string, options: { variant?: 'pie' | 'donut' | 'donut-text'; size?: 'sm' | 'md' | 'lg'; wide?: boolean; loading?: boolean; hasData?: boolean } = {}): Story['render'] {
  return () => ({
    components: { DashboardChartPanel, PageContainer },
    setup() {
      const { t } = useI18n()
      return { chart: computed(() => dashboardCharts(t)[key]), t, title, options, grid: GRID }
    },
    template: `<main class="liwan-shell-main"><PageContainer width="list"><div class="min-w-0" style="container-type: inline-size"><div class="min-w-0" :style="grid"><DashboardChartPanel :test-id="'story-' + title" :title="t(title)" description="" :chart="chart" :variant="options.variant" :has-data="options.hasData ?? true" :loading="options.loading ?? false" :empty-text="t('projects.dashboard.charts.noStatusData')" :accessible-label="t(title)" :span="options.wide ? 'full' : 'half'" :size="options.size" /></div></div></PageContainer></main>`,
  })
}

export const StatusPie: Story = { name: 'حالات المشاريع (pie)', parameters: storyContext('apps/web/app/components/pmo/projects/dashboard/ProjectDashboardCharts.vue:51'), render: panel('status', 'projects.dashboard.charts.statusTitle', { variant: 'pie' }) }
export const TaskDonutText: Story = { name: 'تركيب المهام (donut-text)', parameters: storyContext('apps/web/app/components/pmo/projects/dashboard/ProjectDashboardCharts.vue:51'), render: panel('tasks', 'projects.dashboard.charts.taskTitle', { variant: 'donut-text' }) }
export const ProgressBands: Story = { name: 'شرائح التقدم (bar)', parameters: storyContext('apps/web/app/components/pmo/projects/dashboard/ProjectDashboardCharts.vue:51'), render: panel('progressBands', 'projects.dashboard.charts.progressBandsTitle', { size: 'md' }) }
export const BudgetDonut: Story = { name: 'صحة الميزانية (donut)', parameters: storyContext('apps/web/app/components/pmo/projects/dashboard/ProjectDashboardCharts.vue:51'), render: panel('budget', 'projects.dashboard.charts.budgetHealthTitle', { variant: 'donut', size: 'md' }) }
export const ProjectProgress: Story = { name: 'تقدم المشاريع (bar عريض)', parameters: storyContext('apps/web/app/components/pmo/projects/dashboard/ProjectDashboardCharts.vue:51'), render: panel('projectProgress', 'projects.dashboard.charts.projectProgressTitle', { size: 'lg', wide: true }) }
export const Loading: Story = { name: 'تحميل', parameters: storyContext('apps/web/app/components/pmo/projects/dashboard/ProjectDashboardCharts.vue:51'), render: panel('status', 'projects.dashboard.charts.statusTitle', { variant: 'pie', loading: true }) }
export const NoData: Story = { name: 'بلا بيانات', parameters: storyContext('apps/web/app/components/pmo/projects/dashboard/ProjectDashboardCharts.vue:51'), render: panel('status', 'projects.dashboard.charts.statusTitle', { variant: 'pie', hasData: false }) }
