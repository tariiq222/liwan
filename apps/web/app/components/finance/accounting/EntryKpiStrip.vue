<script setup lang="ts">
import { useFinanceEntrySummary } from '@/composables/finance/useFinanceKpis'
import { entrySummaryParams, entryKpiTiles, type EntryKpiCounts, type EntryListFilters } from './entryListParams'

const props = defineProps<{ filters: EntryListFilters }>()
const { t } = useI18n()
const summary = useFinanceEntrySummary(() => entrySummaryParams(props.filters))
const counts = computed<EntryKpiCounts>(() => ({
  total: summary.data.value?.total,
  draft: summary.data.value?.draft,
  posted: summary.data.value?.posted,
  cancel: summary.data.value?.cancel,
}))
const tiles = computed(() => entryKpiTiles(counts.value, id => t(`financeAccounting.kpi.${id}`)))
const loading = computed(() => summary.data.value === undefined)
</script>

<template>
  <SharedKpiStrip :tiles="tiles" :loading="loading" :label="t('financeAccounting.kpi.label')" data-testid="finance-entry-kpis" />
</template>
