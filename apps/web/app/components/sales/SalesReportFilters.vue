<script setup lang="ts">
import { SALES_REPORT_STAGES, salesReportActiveCount, type SalesReportState } from '@/composables/sales/salesReportParams'

// The filter bar of the sales report: the stage, the order date range, the source, and the salesperson, customer or
// product a row of the breakdown narrowed the report to. The page keeps the state in the address; this component only
// reads it and emits the next query values.
const props = defineProps<{ state: SalesReportState; disabled?: boolean }>()
const emit = defineEmits<{ 'update:query': [values: Record<string, string | undefined>]; clear: [] }>()
const { t } = useI18n()

const ANY_SOURCE = 'any'
const stages = computed(() => SALES_REPORT_STAGES.map(value => ({ value, label: t(`sales.reports.stage.${value}`) })))
const sourceItems = computed(() => [
  { value: ANY_SOURCE, label: t('sales.source.any') },
  { value: 'staff', label: t('sales.source.staff') },
  { value: 'online', label: t('sales.source.online') },
])
const picked = computed(() => (['salesperson', 'customer', 'product'] as const).filter(key => props.state[key] !== null))
const activeCount = computed(() => salesReportActiveCount(props.state))
const set = (values: Record<string, string | undefined>) => emit('update:query', { ...values, page: undefined })
</script>

<template>
  <SharedFilterBar embedded class="w-full" :active-count="activeCount" :title="t('sales.reports.filters.title')" :clear-label="t('sales.clear')" :disabled="props.disabled" @clear="emit('clear')">
    <SharedFilterField :label="t('sales.reports.filters.from')">
      <SharedDateField :model-value="props.state.from || null" :aria-label="t('sales.reports.filters.from')" :max-value="props.state.to || null" :disabled="props.disabled" data-testid="sales-report-from" @update:model-value="set({ from: $event || undefined })" />
    </SharedFilterField>
    <SharedFilterField :label="t('sales.reports.filters.to')">
      <SharedDateField :model-value="props.state.to || null" :aria-label="t('sales.reports.filters.to')" :min-value="props.state.from || null" :disabled="props.disabled" data-testid="sales-report-to" @update:model-value="set({ to: $event || undefined })" />
    </SharedFilterField>
    <USelect :model-value="props.state.source ?? ANY_SOURCE" :items="sourceItems" :aria-label="t('sales.columns.source')" :disabled="props.disabled" data-testid="sales-report-source" @update:model-value="set({ source: $event === ANY_SOURCE ? undefined : String($event) })" />
    <SharedFilterChip v-for="key in picked" :key="key" :label="t(`sales.reports.filters.picked.${key}`)" :disabled="props.disabled" :data-testid="`sales-report-picked-${key}`" @remove="set({ [key]: undefined })" />
    <template #view>
      <SharedSegmentedControl data-testid="sales-report-stage" :label="t('sales.stage.label')" :items="stages" :model-value="props.state.stage" :disabled="props.disabled" @update:model-value="set({ state: $event === 'confirmed' ? undefined : $event })" />
    </template>
  </SharedFilterBar>
</template>
