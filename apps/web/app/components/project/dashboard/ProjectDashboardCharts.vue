<script setup lang="ts">
import type { ProjectReportRow } from '@nasq/contracts'
import ChartCanvas from '@/components/shared/ChartCanvas.client.vue'
import DashboardChartPanel from './DashboardChartPanel.vue'
import {
  projectBudgetHealthData,
  projectBudgetHealthOption,
  projectDashboardCurrencies,
  projectDashboardHasTaskData,
  projectFinanceComparisonData,
  projectFinanceComparisonOption,
  projectProgressBandData,
  projectProgressBandsOption,
  projectProgressByProjectOption,
  projectStatusDoughnutData,
  projectStatusDoughnutOption,
  projectTaskCompositionData,
  projectTaskCompositionOption,
  type ChartLabels,
} from '@/utils/projectChartOptions'

const props = defineProps<{ rows: readonly ProjectReportRow[] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const selectedCurrencyId = ref<number | null>(null)

const labels = computed<ChartLabels>(() => ({
  status: {
    on_track: t('projects.status.on_track'),
    at_risk: t('projects.status.at_risk'),
    off_track: t('projects.status.off_track'),
    on_hold: t('projects.status.on_hold'),
    done: t('projects.status.done'),
    unset: t('projects.status.unset'),
  },
  taskClosed: t('projects.dashboard.charts.taskClosed'),
  taskOpenOnTime: t('projects.dashboard.charts.taskOpenOnTime'),
  taskOverdue: t('projects.dashboard.charts.taskOverdue'),
  progressNoTasks: t('projects.dashboard.charts.progressNoTasks'),
  progressUnknown: t('projects.dashboard.charts.progressUnknown'),
  progress0to25: t('projects.dashboard.charts.progress0to25'),
  progress26to50: t('projects.dashboard.charts.progress26to50'),
  progress51to75: t('projects.dashboard.charts.progress51to75'),
  progress76to99: t('projects.dashboard.charts.progress76to99'),
  progress100: t('projects.dashboard.charts.progress100'),
  budgetUnknown: t('projects.dashboard.charts.budgetUnknown'),
  budgetWithin: t('projects.dashboard.charts.budgetWithin'),
  budgetOver: t('projects.dashboard.charts.budgetOver'),
  planned: t('projects.dashboard.charts.planned'),
  actual: t('projects.dashboard.charts.actual'),
  unavailable: t('projects.dashboard.unknown'),
}))

const currencies = computed(() => projectDashboardCurrencies(props.rows))
const selectedCurrency = computed(() => currencies.value.find(currency => currency.id === selectedCurrencyId.value) ?? currencies.value[0] ?? null)
watch(currencies, values => {
  if (!values.some(currency => currency.id === selectedCurrencyId.value)) selectedCurrencyId.value = values[0]?.id ?? null
}, { immediate: true })

const statusHasData = computed(() => projectStatusDoughnutData(props.rows, labels.value).length > 0)
const taskHasData = computed(() => projectDashboardHasTaskData(props.rows) && projectTaskCompositionData(props.rows, labels.value).length > 0)
const taskEmptyText = computed(() => projectDashboardHasTaskData(props.rows) ? t('projects.dashboard.charts.noTaskItems') : t('projects.dashboard.charts.noTaskData'))
const progressBandsHasData = computed(() => projectProgressBandData(props.rows, labels.value).available)
const budgetHasData = computed(() => projectBudgetHealthData(props.rows, labels.value).length > 0)
const financeHasData = computed(() => selectedCurrency.value != null && projectFinanceComparisonData(props.rows, selectedCurrency.value.id).length > 0)

const statusOption = computed(() => projectStatusDoughnutOption(props.rows, labels.value))
const taskOption = computed(() => projectTaskCompositionOption(props.rows, labels.value))
const progressBandsOption = computed(() => projectProgressBandsOption(props.rows, labels.value))
const budgetOption = computed(() => projectBudgetHealthOption(props.rows, labels.value))
const projectProgressOption = computed(() => projectProgressByProjectOption(props.rows, labels.value))
const financeOption = computed(() => selectedCurrency.value ? projectFinanceComparisonOption(props.rows, selectedCurrency.value.id, labels.value) : {})
</script>

<template>
  <div class="dashboard-chart-container min-w-0">
    <div class="dashboard-chart-grid grid min-w-0 gap-5">
    <DashboardChartPanel
      test-id="chart-status"
      title-id="chart-status-title"
      :title="t('projects.dashboard.charts.statusTitle')"
      :description="t('projects.dashboard.charts.statusDescription')"
      :option="statusOption"
      :has-data="statusHasData"
      :empty-text="t('projects.dashboard.charts.noStatusData')"
      :accessible-label="t('projects.dashboard.charts.statusTitle')"
    />
    <DashboardChartPanel
      test-id="chart-tasks"
      title-id="chart-tasks-title"
      :title="t('projects.dashboard.charts.taskTitle')"
      :description="t('projects.dashboard.charts.taskDescription')"
      :option="taskOption"
      :has-data="taskHasData"
      :empty-text="taskEmptyText"
      :accessible-label="t('projects.dashboard.charts.taskTitle')"
    />
    <DashboardChartPanel
      test-id="chart-progress-bands"
      title-id="chart-progress-bands-title"
      :title="t('projects.dashboard.charts.progressBandsTitle')"
      :description="t('projects.dashboard.charts.progressBandsDescription')"
      :option="progressBandsOption"
      :has-data="progressBandsHasData"
      :empty-text="t('projects.dashboard.charts.noProgressData')"
      :accessible-label="t('projects.dashboard.charts.progressBandsTitle')"
      height="240px"
    />
    <DashboardChartPanel
      test-id="chart-budget-health"
      title-id="chart-budget-health-title"
      :title="t('projects.dashboard.charts.budgetHealthTitle')"
      :description="t('projects.dashboard.charts.budgetHealthDescription')"
      :option="budgetOption"
      :has-data="budgetHasData"
      :empty-text="t('projects.dashboard.charts.noBudgetData')"
      :accessible-label="t('projects.dashboard.charts.budgetHealthTitle')"
      height="240px"
    />
    <DashboardChartPanel
      test-id="chart-project-progress"
      title-id="chart-project-progress-title"
      :title="t('projects.dashboard.charts.projectProgressTitle')"
      :description="t('projects.dashboard.charts.projectProgressDescription')"
      :option="projectProgressOption"
      :has-data="rows.length > 0"
      :empty-text="t('projects.dashboard.charts.noProgressData')"
      :accessible-label="t('projects.dashboard.charts.projectProgressTitle')"
      height="360px"
    />
    <section data-testid="chart-project-finance" aria-labelledby="chart-project-finance-title" class="nasq-panel flex min-w-0 flex-col overflow-hidden">
      <header class="nasq-panel-header flex-wrap items-start">
        <div class="min-w-0">
          <h2 id="chart-project-finance-title" class="text-base font-semibold leading-6">{{ t('projects.dashboard.charts.financeTitle') }}</h2>
          <p class="mt-1 text-sm leading-6 text-muted-foreground">{{ t('projects.dashboard.charts.financeDescription') }}</p>
        </div>
        <Select v-if="currencies.length" :model-value="selectedCurrency ? String(selectedCurrency.id) : undefined" @update:model-value="value => { selectedCurrencyId = Number(value) }">
          <SelectTrigger data-testid="chart-currency-filter" class="w-full sm:w-44" :disabled="!hydrated">
            <SelectValue :placeholder="t('projects.dashboard.charts.currency')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="currency in currencies" :key="currency.id" :value="String(currency.id)">{{ currency.name }} ({{ currency.symbol }})</SelectItem>
          </SelectContent>
        </Select>
      </header>
      <div class="nasq-panel-body min-w-0">
        <div v-if="financeHasData" class="min-w-0">
          <ChartCanvas :option="financeOption" :accessible-label="t('projects.dashboard.charts.financeTitle')" height="360px" />
        </div>
        <p v-else class="flex min-h-[220px] items-center justify-center text-center text-sm text-muted-foreground">{{ t('projects.dashboard.charts.noFinanceData') }}</p>
      </div>
    </section>
    </div>
  </div>
</template>

<style scoped>
.dashboard-chart-container {
  container-type: inline-size;
}

@container (min-width: 760px) {
  .dashboard-chart-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard-chart-grid > [data-testid="chart-project-progress"],
  .dashboard-chart-grid > [data-testid="chart-project-finance"] {
    grid-column: span 2;
  }
}

</style>
