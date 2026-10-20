<script setup lang="ts">
import { useFinanceEntryList } from '@/composables/finance/useFinanceEntries'
import { entryKpiParams, entryKpiTiles, type EntryKpiCounts, type EntryListFilters } from './entryListParams'

// The counts above the entries list: every figure is the total the server reports for the list's own filters
// (the state filter excepted: each tile picks its state), asked for with one row, never counted from the loaded page.
const props = defineProps<{ filters: EntryListFilters }>()
const { t } = useI18n()
const total = useFinanceEntryList(() => entryKpiParams(props.filters, null))
const draft = useFinanceEntryList(() => entryKpiParams(props.filters, 'draft'))
const posted = useFinanceEntryList(() => entryKpiParams(props.filters, 'posted'))
const cancelled = useFinanceEntryList(() => entryKpiParams(props.filters, 'cancel'))
const counts = computed<EntryKpiCounts>(() => ({
  total: total.data.value?.total,
  draft: draft.data.value?.total,
  posted: posted.data.value?.total,
  cancel: cancelled.data.value?.total,
}))
const tiles = computed(() => entryKpiTiles(counts.value, id => t(`financeAccounting.kpi.${id}`)))
const loading = computed(() => Object.values(counts.value).some(count => count === undefined))
</script>

<template>
  <SharedKpiStrip :tiles="tiles" :loading="loading" :label="t('financeAccounting.kpi.label')" data-testid="finance-entry-kpis" />
</template>
