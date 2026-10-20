<script setup lang="ts">
import { useFinanceBankStatements } from '@/composables/finance/useFinanceBank'
import { bankKpiParams, bankKpiTiles, type BankListFilters } from './bankListParams'

// The counts above the statements list: every figure is the total the server reports (all statements, and the ones the
// list's filters keep), asked for with one row, never counted from the loaded page.
const props = defineProps<{ filters: BankListFilters; filtered: boolean }>()
const { t } = useI18n()
const all = useFinanceBankStatements(() => bankKpiParams(null))
const kept = useFinanceBankStatements(() => bankKpiParams(props.filters), () => props.filtered)
const counts = computed(() => ({ all: all.data.value?.total, filtered: kept.data.value?.total }))
const tiles = computed(() => bankKpiTiles(counts.value, props.filtered, id => t(`financeBank.kpi.${id}`)))
const loading = computed(() => counts.value.all === undefined || (props.filtered && counts.value.filtered === undefined))
</script>

<template>
  <SharedKpiStrip :tiles="tiles" :loading="loading" :label="t('financeBank.kpi.label')" data-testid="finance-bank-kpis" />
</template>
