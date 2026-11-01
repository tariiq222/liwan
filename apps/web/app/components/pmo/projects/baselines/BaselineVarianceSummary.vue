<script setup lang="ts">
import type { BaselineVariance } from '@liwan/contracts'
import { formatMoney } from '@/utils/projectFinance'
import { varianceLabel, varianceTone } from './variance'

// The project-level reading of the latest baseline: how far the end date moved and what the budget and the actual cost do against it.
const props = defineProps<{ variance: BaselineVariance }>()
const { t } = useI18n()
const schedule = computed(() => props.variance.schedule)
const cost = computed(() => props.variance.cost)
const money = (value: number) => cost.value?.currency ? formatMoney(value, cost.value.currency) : String(value)
const signedMoney = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value))}`
</script>

<template>
  <div v-if="variance.baseline && schedule && cost" class="grid gap-(--liwan-gap-card) md:grid-cols-2" data-testid="baseline-variance-summary">
    <SharedRecordSection variant="panel" :title="t('projects.baselines.variance.scheduleTitle', { number: variance.baseline.number })">
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('projects.baselines.variance.endDate')">
          <span class="inline-flex flex-wrap items-center gap-2">
            <span dir="ltr" class="tabular-nums">{{ schedule.project.baseline_end ?? '—' }} → {{ schedule.project.current_end ?? '—' }}</span>
            <SharedStatusBadge v-if="varianceLabel(schedule.project.end_variance_days)" :tone="varianceTone(schedule.project.end_variance_days)" :label="t('projects.baselines.variance.days', { days: varianceLabel(schedule.project.end_variance_days) })" />
          </span>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.baselines.variance.late')" :value="String(schedule.late_count)" />
        <SharedPropertyRow :label="t('projects.baselines.variance.early')" :value="String(schedule.early_count)" />
        <SharedPropertyRow :label="t('projects.baselines.variance.undated')" :value="String(schedule.undated_count)" />
      </SharedPropertiesPanel>
    </SharedRecordSection>
    <SharedRecordSection variant="panel" :title="t('projects.baselines.variance.costTitle')">
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('projects.baselines.variance.baselineBudget')"><span dir="ltr" class="tabular-nums">{{ money(cost.baseline_budget) }}</span></SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.baselines.variance.currentBudget')">
          <span class="inline-flex flex-wrap items-center gap-2">
            <span dir="ltr" class="tabular-nums">{{ money(cost.current_budget) }}</span>
            <SharedStatusBadge v-if="cost.budget_variance !== 0" :tone="cost.budget_variance > 0 ? 'warning' : 'info'" :label="signedMoney(cost.budget_variance)" />
          </span>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.baselines.variance.actual')"><span dir="ltr" class="tabular-nums">{{ money(cost.actual) }}</span></SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.baselines.variance.remaining')">
          <span class="inline-flex flex-wrap items-center gap-2">
            <span dir="ltr" class="tabular-nums">{{ money(cost.remaining_against_baseline) }}</span>
            <SharedStatusBadge v-if="cost.over_baseline" tone="destructive" :label="t('projects.baselines.variance.overBaseline')" />
          </span>
        </SharedPropertyRow>
      </SharedPropertiesPanel>
    </SharedRecordSection>
  </div>
</template>
