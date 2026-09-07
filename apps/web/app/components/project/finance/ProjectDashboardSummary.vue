<script setup lang="ts">
import { CircleAlert, CircleDollarSign, Clock3, FolderKanban } from '@lucide/vue'
import type { ProjectDashboardSummary, ProjectReportRow } from '@nasq/contracts'
import ProjectStatusBadge from '@/components/project/ProjectStatusBadge.vue'
import {
  projectDashboardBudgetBars,
  projectDashboardFinanceRows,
  projectDashboardProgress,
  projectDashboardStatusBars,
} from '@/utils/projectDashboard'
import { formatMoney, formatNullableAmount, formatNullableCount } from '@/utils/projectFinance'
import { returnToQuery } from '@/utils/safeReturnTo'

const props = defineProps<{
  summary: ProjectDashboardSummary | null | undefined
  isLoading: boolean
  error: unknown
}>()

const emit = defineEmits<{ retry: [] }>()
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const unknown = computed(() => t('projects.dashboard.unknown'))
const unavailable = computed(() => t('projects.dashboard.unavailable'))
const statusBars = computed(() => projectDashboardStatusBars(props.summary?.status_counts ?? []))
const financeRows = computed(() => projectDashboardFinanceRows(props.summary?.totals ?? []))

function rowProgress(row: ProjectReportRow) {
  return projectDashboardProgress(row)
}

function budgetBars(row: { planned: number | null; actual: number }) {
  return projectDashboardBudgetBars(row)
}

function attentionPath(row: ProjectReportRow) {
  return row.finance.over_budget ? `/projects/${row.project.id}/finance` : `/projects/${row.project.id}`
}

function attentionReason(row: ProjectReportRow) {
  if (row.finance.over_budget) return t('projects.dashboard.overBudget')
  if ((row.overdue_task_count ?? 0) > 0) return t('projects.dashboard.overdue', { count: row.overdue_task_count })
  return row.project.status ? t(`projects.status.${row.project.status}`) : t('projects.status.unset')
}
</script>

<template>
  <section data-testid="project-dashboard-summary" class="space-y-5" aria-labelledby="project-dashboard-summary-title">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="project-dashboard-summary-title" class="text-base font-semibold">{{ t('projects.dashboard.summaryTitle') }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('projects.dashboard.summaryDescription') }}</p>
      </div>
      <Button v-if="error" variant="outline" size="sm" :disabled="!hydrated" @click="emit('retry')">
        {{ t('projects.dashboard.retry') }}
      </Button>
    </div>

    <div v-if="error" role="alert" data-testid="project-dashboard-summary-error" class="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      {{ t('projects.dashboard.summaryError') }}
    </div>

    <div v-else-if="isLoading && !summary" data-testid="project-dashboard-summary-loading" class="grid gap-3 sm:grid-cols-3">
      <div v-for="n in 3" :key="n" class="rounded-lg border bg-card p-4"><Skeleton class="h-16 w-full" /></div>
    </div>

    <template v-else-if="summary">
      <div class="grid gap-3 sm:grid-cols-3">
        <article class="flex items-center gap-3 rounded-lg border bg-card p-4">
          <span class="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground"><FolderKanban class="size-[18px]" /></span>
          <div>
            <p class="text-xs text-muted-foreground">{{ t('projects.dashboard.projectCount') }}</p>
            <p data-testid="project-dashboard-project-count" class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.project_count }}</p>
          </div>
        </article>
        <article class="flex items-center gap-3 rounded-lg border bg-card p-4">
          <span class="nasq-status-icon-warning grid size-9 shrink-0 place-items-center rounded-lg"><CircleAlert class="size-[18px]" /></span>
          <div>
            <p class="text-xs text-muted-foreground">{{ t('projects.dashboard.attentionCount') }}</p>
            <p data-testid="project-dashboard-attention-count" class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.attention_project_count }}</p>
          </div>
        </article>
        <article class="flex items-center gap-3 rounded-lg border bg-card p-4">
          <span class="nasq-status-icon-warning grid size-9 shrink-0 place-items-center rounded-lg"><Clock3 class="size-[18px]" /></span>
          <div>
            <p class="text-xs text-muted-foreground">{{ t('projects.dashboard.overdueCount') }}</p>
            <p data-testid="project-dashboard-overdue-count" class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.overdue_task_count == null ? unknown : summary.overdue_task_count }}</p>
          </div>
        </article>
      </div>

      <div v-if="summary.project_count === 0" data-testid="project-dashboard-summary-empty" class="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        {{ t('projects.dashboard.empty') }}
      </div>

      <div v-else class="grid gap-4 xl:grid-cols-2">
        <section class="rounded-lg border bg-card p-4" aria-labelledby="project-dashboard-status-title">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 id="project-dashboard-status-title" class="font-semibold">{{ t('projects.dashboard.statusTitle') }}</h3>
              <p class="mt-1 text-sm text-muted-foreground">{{ t('projects.dashboard.statusDescription') }}</p>
            </div>
          </div>
          <div v-if="statusBars.length" class="mt-4 space-y-3">
            <div v-for="bar in statusBars" :key="bar.status ?? 'unset'" class="space-y-1">
              <div class="flex items-center justify-between gap-3 text-sm">
                <span>{{ bar.status ? t(`projects.status.${bar.status}`) : t('projects.status.unset') }}</span>
                <span class="tabular-nums text-muted-foreground">{{ bar.count }} ({{ bar.percent }}%)</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" :aria-valuenow="bar.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="bar.status ? t(`projects.status.${bar.status}`) : t('projects.status.unset')">
                <div class="h-full rounded-full bg-primary dark:bg-foreground/80 transition-[width]" :style="{ width: `${bar.percent}%` }" />
              </div>
            </div>
          </div>
          <p v-else class="mt-4 text-sm text-muted-foreground">{{ t('projects.dashboard.noStatusData') }}</p>
        </section>

        <section class="rounded-lg border bg-card p-4" aria-labelledby="project-dashboard-finance-title">
          <div>
            <h3 id="project-dashboard-finance-title" class="font-semibold">{{ t('projects.dashboard.financeTitle') }}</h3>
            <p class="mt-1 text-sm text-muted-foreground">{{ t('projects.dashboard.financeDescription') }}</p>
          </div>
          <div v-if="financeRows.length" class="mt-4 grid gap-3" :class="{ 'md:grid-cols-2': financeRows.length > 1 }">
            <article v-for="row in financeRows" :key="row.currency.id" class="rounded-lg border p-3">
              <div class="flex items-center gap-2 font-medium"><CircleDollarSign class="size-4 text-muted-foreground" />{{ row.currency.name }} ({{ row.currency.symbol }})</div>
              <dl class="mt-3 space-y-2 text-sm">
                <div class="flex justify-between gap-3"><dt class="text-muted-foreground">{{ t('projects.dashboard.planned') }}</dt><dd dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.planned, row.currency, unknown) }}</dd></div>
                <div class="flex justify-between gap-3"><dt class="text-muted-foreground">{{ t('projects.dashboard.actual') }}</dt><dd dir="ltr" class="tabular-nums">{{ formatMoney(row.actual, row.currency) }}</dd></div>
                <div class="flex justify-between gap-3"><dt class="text-muted-foreground">{{ t('projects.dashboard.remaining') }}</dt><dd dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.remaining, row.currency, unknown) }}</dd></div>
                <div class="flex justify-between gap-3"><dt class="text-muted-foreground">{{ t('projects.dashboard.budgetStatus') }}</dt><dd class="tabular-nums">{{ row.amountsKnown ? (row.overBudgetCount > 0 ? t('projects.dashboard.overBudgetProjects', { count: row.overBudgetCount, budgeted: row.budgetedProjectCount }) : row.unknownBudgetProjectCount > 0 ? t('projects.dashboard.withinBudgetKnown', { budgeted: row.budgetedProjectCount, total: row.projectCount }) : t('projects.dashboard.withinBudget')) : unknown }}</dd></div>
              </dl>
              <div class="mt-4 space-y-3" :aria-label="t('projects.dashboard.budgetComparison')">
                <div v-if="budgetBars(row).plannedPercent != null" class="space-y-1">
                  <div class="flex items-center justify-between gap-3 text-xs"><span>{{ t('projects.dashboard.planned') }}</span><span class="tabular-nums text-muted-foreground">{{ budgetBars(row).plannedPercent }}%</span></div>
                  <div class="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" :aria-valuenow="budgetBars(row).plannedPercent ?? 0" aria-valuemin="0" aria-valuemax="100" :aria-label="t('projects.dashboard.planned')"><div class="h-full rounded-full bg-primary dark:bg-foreground/80" :style="{ width: `${budgetBars(row).plannedPercent ?? 0}%` }" /></div>
                </div>
                <div class="space-y-1">
                  <div class="flex items-center justify-between gap-3 text-xs"><span>{{ t('projects.dashboard.actual') }}</span><span class="tabular-nums text-muted-foreground">{{ budgetBars(row).actualPercent }}%</span></div>
                  <div class="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" :aria-valuenow="budgetBars(row).actualPercent" aria-valuemin="0" aria-valuemax="100" :aria-label="t('projects.dashboard.actual')"><div class="h-full rounded-full bg-primary dark:bg-foreground/80" :style="{ width: `${budgetBars(row).actualPercent}%` }" /></div>
                </div>
              </div>
              <p v-if="row.unknownBudgetProjectCount > 0" class="mt-3 text-xs text-muted-foreground">{{ t('projects.dashboard.budgetCoverage', { budgeted: row.budgetedProjectCount, total: row.projectCount }) }}</p>
            </article>
          </div>
          <p v-else class="mt-4 text-sm text-muted-foreground">{{ t('projects.dashboard.noFinanceData') }}</p>
        </section>
      </div>

      <section class="rounded-lg border bg-card p-4" aria-labelledby="project-dashboard-attention-title">
        <div>
          <h3 id="project-dashboard-attention-title" class="font-semibold">{{ t('projects.dashboard.attentionTitle') }}</h3>
          <p class="mt-1 text-sm text-muted-foreground">{{ t('projects.dashboard.attentionDescription') }}</p>
        </div>
        <div v-if="summary.attention.length" class="mt-3 divide-y divide-border">
          <div v-for="row in summary.attention" :key="row.project.id" class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div class="min-w-0">
              <NuxtLink :to="{ path: attentionPath(row), query: returnToQuery(route.fullPath) }" class="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{{ row.project.name }}</NuxtLink>
              <p class="mt-1 text-xs text-muted-foreground">{{ attentionReason(row) }}</p>
            </div>
            <div class="flex items-center gap-3 text-sm"><ProjectStatusBadge :status="row.project.status" /><span class="text-muted-foreground">{{ t('projects.dashboard.closedOf', { closed: formatNullableCount(rowProgress(row).closed, unavailable), total: formatNullableCount(rowProgress(row).total, unavailable) }) }}</span></div>
          </div>
        </div>
        <p v-else class="mt-3 text-sm text-muted-foreground">{{ t('projects.dashboard.noAttention') }}</p>
      </section>
    </template>
  </section>
</template>
