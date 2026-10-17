import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ChartPanel from '@webvue/ui/app/components/shared/data/ChartPanel.vue'
import DashboardChart from '../../app/components/shared/data/DashboardChart.client.vue'
import DashboardPage from '@webvue/ui/app/components/shared/layout/DashboardPage.vue'
import RecordSection from '@webvue/ui/app/components/shared/layout/RecordSection.vue'
import MetricTile from '@webvue/ui/app/components/shared/data/MetricTile.vue'
import { dashboardCharts } from '../fixtures/projectReports'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/DashboardPage',
  component: DashboardPage,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('unused', 'قالب اللوحة: ترويسة الصفحة وإجراءاتها، صف مؤشرات، ثم شبكة مخططات تصير عمودين متى بلغ عرضها 768px. المخطط العريض `span="full"`، وارتفاع المخطط `size` (sm 224 وmd 300 وlg 360). الفتحة `primary` لكتلة الإجراء الوحيدة بعرض كامل فوق المؤشرات.'),
  },
  args: { title: '' },
} satisfies Meta<typeof DashboardPage>
export default meta
type Story = StoryObj<typeof meta>

// `states` puts the first chart in loading and the second in its empty line.
const page = (states: boolean): Story['render'] => () => ({
  components: { ChartPanel, DashboardChart, DashboardPage, MetricTile, RecordSection },
  setup() {
    const { t } = useI18n()
    // Unovis measures axis labels once at mount; drawing before the web font is ready
    // gives fallback-font metrics and a 1px shifted plot in the visual baselines.
    const fontsReady = ref(false)
    onMounted(() => { void document.fonts.ready.then(() => { fontsReady.value = true }) })
    return { t, states, fontsReady, charts: computed(() => dashboardCharts(t)) }
  },
  template: `<main class="webvue-shell-main">
    <DashboardPage :title="t('projects.dashboard.title')">
      <template #actions>
        <UButton color="neutral" variant="outline" to="/projects" :label="t('projects.dashboard.allProjects')" />
      </template>
      <template v-if="!states" #primary>
        <RecordSection variant="action" :title="t('projects.dashboard.title')" :description="t('projects.description')">
          <template #actions><UButton size="sm" to="/projects" :label="t('projects.dashboard.allProjects')" /></template>
        </RecordSection>
      </template>
      <template #metrics>
        <MetricTile icon="i-lucide-folder-kanban" :label="t('projects.dashboard.metrics.projects')" :value="4" />
        <MetricTile icon="i-lucide-activity" :label="t('projects.dashboard.metrics.active')" :value="3" />
        <MetricTile icon="i-lucide-list-checks" :label="t('projects.dashboard.metrics.taskProgress')" :value="62" unit="%" value-dir="ltr" />
        <MetricTile icon="i-lucide-wallet" :label="t('projects.dashboard.metrics.budgeted')" :value="2" />
      </template>
      <ChartPanel :title="t('projects.dashboard.charts.statusTitle')" :loading="states">
        <DashboardChart :chart="charts.status" variant="pie" :accessible-label="t('projects.dashboard.charts.statusTitle')" />
      </ChartPanel>
      <ChartPanel :title="t('projects.dashboard.charts.taskTitle')" :empty="states">
        <DashboardChart :chart="charts.tasks" variant="donut-text" :accessible-label="t('projects.dashboard.charts.taskTitle')" />
      </ChartPanel>
      <ChartPanel span="full" size="lg" :title="t('projects.dashboard.charts.projectProgressTitle')" v-slot="{ height }">
        <DashboardChart v-if="fontsReady" :chart="charts.projectProgress" :height="height" :accessible-label="t('projects.dashboard.charts.projectProgressTitle')" />
      </ChartPanel>
    </DashboardPage>
  </main>`,
})

export const Default: Story = { name: 'لوحة كاملة', render: page(false) }
export const ChartStates: Story = { name: 'مخطط يُحمَّل وآخر بلا بيانات', render: page(true) }
