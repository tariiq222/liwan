<script setup lang="ts">
import type { ProjectReportRow } from '@nasq/contracts'
import DashboardChart from '@/components/shared/data/DashboardChart.client.vue'
import DashboardChartPanel from './DashboardChartPanel.vue'
import {
  projectDashboardCurrencies,
  projectDashboardHasTaskData,
  projectBudgetHealthChart,
  projectFinanceComparisonData,
  projectFinanceComparisonChart,
  projectProgressBandData,
  projectProgressBandsChart,
  projectProgressByProjectChart,
  projectStatusBarChart,
  projectTaskCompositionChart,
  projectChartLabels,
  type ChartLabels,
} from '@/utils/projectChartData'

// The six charts of the dashboard as chart panels. They render straight into SharedDashboardPage's grid
// (two columns from 768px of the grid's own width); the progress and finance charts span both.
const props = defineProps<{ rows: readonly ProjectReportRow[] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const selectedCurrencyId = ref<number | null>(null)

const labels = computed<ChartLabels>(() => projectChartLabels(t))

const currencies = computed(() => projectDashboardCurrencies(props.rows))
const selectedCurrency = computed(() => currencies.value.find(currency => currency.id === selectedCurrencyId.value) ?? currencies.value[0] ?? null)
watch(currencies, values => {
  if (!values.some(currency => currency.id === selectedCurrencyId.value)) selectedCurrencyId.value = values[0]?.id ?? null
}, { immediate: true })

const statusHasData = computed(() => props.rows.length > 0)
const taskHasData = computed(() => projectDashboardHasTaskData(props.rows))
const taskEmptyText = computed(() => projectDashboardHasTaskData(props.rows) ? t('projects.dashboard.charts.noTaskItems') : t('projects.dashboard.charts.noTaskData'))
const progressBandsHasData = computed(() => projectProgressBandData(props.rows, labels.value).available)
const budgetHasData = computed(() => props.rows.length > 0)
const financeHasData = computed(() => selectedCurrency.value != null && projectFinanceComparisonData(props.rows, selectedCurrency.value.id).length > 0)

const statusChart = computed(() => projectStatusBarChart(props.rows, labels.value))
const taskChart = computed(() => projectTaskCompositionChart(props.rows, labels.value, t('projects.dashboard.charts.taskTitle')))
const progressBandsChart = computed(() => projectProgressBandsChart(props.rows, labels.value))
const budgetChart = computed(() => projectBudgetHealthChart(props.rows, labels.value, t('projects.dashboard.charts.budgetCenterLabel')))
const projectProgressChart = computed(() => projectProgressByProjectChart(props.rows, labels.value))
const financeChart = computed(() => selectedCurrency.value ? projectFinanceComparisonChart(props.rows, selectedCurrency.value.id, labels.value) : null)
</script>

<template>
  <DashboardChartPanel
    test-id="chart-status"
    :title="t('projects.dashboard.charts.statusTitle')"
    :description="t('projects.dashboard.charts.statusDescription')"
    :chart="statusChart"
    :has-data="statusHasData"
    :empty-text="t('projects.dashboard.charts.noStatusData')"
    :accessible-label="t('projects.dashboard.charts.statusTitle')"
    height="240px"
  />
  <DashboardChartPanel
    test-id="chart-tasks"
    :title="t('projects.dashboard.charts.taskTitle')"
    :description="t('projects.dashboard.charts.taskDescription')"
    :chart="taskChart"
    variant="donut-text"
    :has-data="taskHasData"
    :empty-text="taskEmptyText"
    :accessible-label="t('projects.dashboard.charts.taskTitle')"
  />
  <DashboardChartPanel
    test-id="chart-progress-bands"
    :title="t('projects.dashboard.charts.progressBandsTitle')"
    :description="t('projects.dashboard.charts.progressBandsDescription')"
    :chart="progressBandsChart"
    :has-data="progressBandsHasData"
    :empty-text="t('projects.dashboard.charts.noProgressData')"
    :accessible-label="t('projects.dashboard.charts.progressBandsTitle')"
    height="240px"
  />
  <DashboardChartPanel
    test-id="chart-budget-health"
    :title="t('projects.dashboard.charts.budgetHealthTitle')"
    :description="t('projects.dashboard.charts.budgetHealthDescription')"
    :chart="budgetChart"
    variant="donut-text"
    :has-data="budgetHasData"
    :empty-text="t('projects.dashboard.charts.noBudgetData')"
    :accessible-label="t('projects.dashboard.charts.budgetHealthTitle')"
    height="240px"
  />
  <DashboardChartPanel
    class="@min-[768px]:col-span-2"
    test-id="chart-project-progress"
    :title="t('projects.dashboard.charts.projectProgressTitle')"
    :description="t('projects.dashboard.charts.projectProgressDescription')"
    :chart="projectProgressChart"
    :has-data="rows.length > 0"
    :empty-text="t('projects.dashboard.charts.noProgressData')"
    :accessible-label="t('projects.dashboard.charts.projectProgressTitle')"
    height="360px"
  />
  <SharedChartPanel
    class="@min-[768px]:col-span-2"
    data-testid="chart-project-finance"
    :title="t('projects.dashboard.charts.financeTitle')"
    :description="t(currencies.length > 1 ? 'projects.dashboard.charts.financeDescription' : 'projects.dashboard.charts.financeDescriptionSingle')"
    :empty="!financeHasData"
    :empty-text="t('projects.dashboard.charts.noFinanceData')"
  >
    <template v-if="currencies.length > 1" #actions>
      <USelect
        data-testid="chart-currency-filter"
        :model-value="selectedCurrency ? String(selectedCurrency.id) : undefined"
        :items="currencies.map(currency => ({ value: String(currency.id), label: `${currency.name} (${currency.symbol})` }))"
        :aria-label="t('projects.dashboard.charts.currency')"
        :placeholder="t('projects.dashboard.charts.currency')"
        class="min-w-44 sm:w-44"
        :disabled="!hydrated"
        @update:model-value="value => { selectedCurrencyId = Number(value) }"
      />
    </template>
    <p v-if="currencies.length === 1 && selectedCurrency" class="mb-2 text-sm text-muted" data-testid="chart-currency-label">{{ selectedCurrency.name }} ({{ selectedCurrency.symbol }})</p>
    <DashboardChart v-if="financeChart" :chart="financeChart" :accessible-label="t('projects.dashboard.charts.financeTitle')" height="360px" />
  </SharedChartPanel>
</template>
