<script setup lang="ts">
import { useFinanceAnalyticPlans } from '@/composables/finance/useFinanceAnalytic'
import { useFinanceBudgetList } from '@/composables/finance/useFinanceBudgets'
import { useFinancePartner } from '@/composables/finance/useFinancePartners'
import PartnerPicker from '../invoices/PartnerPicker.vue'
import { REPORTS, type ReportSlug } from './reportConfig'
import { reportEndsOnly, STATEMENT_KINDS, STATEMENT_TYPES, TARGET_MOVES, type ReportFilters } from './reportParams'

// The filter bar of a report card: only the filters the report takes (reportConfig). A value equal to its default is
// left out of the URL; the period shows its resolved days and is written once the user changes it.
const BUDGET_CHOICES = 100
const props = defineProps<{ slug: ReportSlug; filters: ReportFilters; activeCount: number; disabled?: boolean }>()
const emit = defineEmits<{ change: [values: Record<string, string | undefined>]; clear: [] }>()
const { t } = useI18n()
const set = computed(() => REPORTS[props.slug].filters)
const endsOnly = computed(() => reportEndsOnly(props.slug, props.filters))
const partner = useFinancePartner(() => props.filters.partnerId)
const plans = useFinanceAnalyticPlans(() => set.value.plan)
const budgets = useFinanceBudgetList({ limit: BUDGET_CHOICES, offset: 0 }, () => set.value.budget)

const choices = (group: string, values: readonly string[]) => values.map(value => ({ value, label: t(`financeReports.filters.${group}.${value}`) }))
const budgetItems = computed(() => (budgets.data.value?.items ?? []).map(budget => ({ value: String(budget.id), label: budget.name })))
// A budget report without a chosen day runs to the end of the budget, so its day field stays empty until the user picks one.
const dateTo = computed(() => set.value.budget && !props.filters.dateToSet ? null : props.filters.dateTo)
const targetMoveItems = computed(() => choices('targetMove', TARGET_MOVES))
const kindItems = computed(() => choices('kind', STATEMENT_KINDS))
const typeItems = computed(() => choices('type', STATEMENT_TYPES))
const planItems = computed(() => [{ value: 'all', label: t('financeReports.filters.allPlans') }, ...(plans.data.value?.items ?? []).map(plan => ({ value: String(plan.id), label: plan.name }))])

// Any filter change restarts the ledger lines at their first page; a new type or period never keeps an old account.
function change(values: Record<string, string | undefined>) {
  emit('change', { ...values, page: undefined })
}
const choose = (key: string, fallback: string, value: string) => change({ [key]: value === fallback ? undefined : value })
const setDate = (key: 'date_from' | 'date_to', value: string | null) => change({ [key]: value ?? undefined })
const setPlan = (value: unknown) => change({ plan_id: value === 'all' ? undefined : String(value) })
const setBudget = (value: unknown) => change({ budget_id: String(value) })
const setPartner = (value: number | null) => change({ partner_id: value ? String(value) : undefined })
</script>

<template>
  <SharedFilterBar embedded class="w-full" :active-count="activeCount" :default-open="activeCount > 0" :disabled="disabled" @clear="emit('clear')">
    <SharedFilterField v-if="set.partner" :label="t('financeReports.filters.partner')" for="finance-report-partner">
      <PartnerPicker id="finance-report-partner" class="md:w-56" :model-value="filters.partnerId" kind="any" :known="partner.data.value ? { id: partner.data.value.id, name: partner.data.value.name } : null" :placeholder="t('financeReports.filters.partnerPlaceholder')" :disabled="disabled" @update:model-value="setPartner" />
    </SharedFilterField>
    <SharedFilterField v-if="set.budget" :label="t('financeReports.filters.budget')" for="finance-report-budget">
      <USelect id="finance-report-budget" class="w-full md:w-64" :model-value="filters.budgetId ? String(filters.budgetId) : undefined" :items="budgetItems" :placeholder="t('financeReports.filters.budgetPlaceholder')" :loading="budgets.isPending.value" :disabled="disabled" @update:model-value="setBudget" />
    </SharedFilterField>
    <SharedFilterField v-if="set.type" :label="t('financeReports.filters.typeLabel')">
      <SharedSegmentedControl :label="t('financeReports.filters.typeLabel')" :items="typeItems" :model-value="filters.type" :disabled="disabled" @update:model-value="choose('type', 'activity', $event)" />
    </SharedFilterField>
    <SharedFilterField v-if="set.kind" :label="t('financeReports.filters.kindLabel')">
      <SharedSegmentedControl :label="t('financeReports.filters.kindLabel')" :items="kindItems" :model-value="filters.kind" :disabled="disabled" @update:model-value="choose('kind', 'receivable', $event)" />
    </SharedFilterField>
    <SharedFilterField v-if="!endsOnly" :label="t('financeReports.filters.dateFrom')" for="finance-report-from">
      <SharedDateField id="finance-report-from" :model-value="filters.dateFrom" :max-value="filters.dateTo" :disabled="disabled" @update:model-value="setDate('date_from', $event)" />
    </SharedFilterField>
    <SharedFilterField :label="t(endsOnly ? 'financeReports.filters.asOf' : 'financeReports.filters.dateTo')" for="finance-report-to">
      <SharedDateField id="finance-report-to" :model-value="dateTo" :min-value="endsOnly ? null : filters.dateFrom" :disabled="disabled" @update:model-value="setDate('date_to', $event)" />
    </SharedFilterField>
    <SharedFilterField v-if="set.plan" :label="t('financeReports.filters.plan')" for="finance-report-plan">
      <USelect id="finance-report-plan" class="w-full md:w-48" :model-value="filters.planId ? String(filters.planId) : 'all'" :items="planItems" :disabled="disabled" @update:model-value="setPlan" />
    </SharedFilterField>
    <SharedFilterField v-if="set.targetMove" :label="t('financeReports.filters.targetMoveLabel')">
      <SharedSegmentedControl :label="t('financeReports.filters.targetMoveLabel')" :items="targetMoveItems" :model-value="filters.targetMove" :disabled="disabled" @update:model-value="choose('target_move', 'posted', $event)" />
    </SharedFilterField>
  </SharedFilterBar>
</template>
