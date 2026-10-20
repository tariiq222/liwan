<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceAuditEvent } from '@webvue/contracts'
import { useFinanceAuditEvents } from '@/composables/finance/useFinanceAudit'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import { listReturnTo } from '../invoices/listLocation'
import {
  AUDIT_ACTIONS, AUDIT_PAGE_SIZE, AUDIT_PATH, auditActiveFilterCount, auditFiltersFromQuery, auditListParams, formatAuditTime,
} from './auditParams'

// The read-only card of the finance audit log. The page owns the settings shell and heading.
const { t, locale } = useI18n()
const { can } = useAccess()
const allowed = computed(() => can('finance.audit.read'))
const { hydrated, filterQuery, update } = useRouteListFilters({ fallbackPath: () => AUDIT_PATH, safeReturnTo: listReturnTo(AUDIT_PATH) })
const filters = computed(() => auditFiltersFromQuery(filterQuery.value))
const activeCount = computed(() => auditActiveFilterCount(filters.value))
const query = useFinanceAuditEvents(() => auditListParams(filters.value), allowed)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / AUDIT_PAGE_SIZE)))
const showEmpty = computed(() => !query.isPending.value && !query.error.value && items.value.length === 0)

const actionItems = computed(() => [
  { value: 'all', label: t('financeGovernance.audit.filters.allActions') },
  ...AUDIT_ACTIONS.map(action => ({ value: action, label: t(`financeGovernance.audit.actions.${action}`) })),
])
function clearFilters() {
  void update({ action: undefined, date_from: undefined, date_to: undefined, page: undefined })
}
function setAction(value: unknown) {
  void update({ action: value === 'all' ? undefined : String(value), page: undefined })
}
function setDate(key: 'date_from' | 'date_to', value: string | null) {
  void update({ [key]: value ?? undefined, page: undefined })
}

const columns = computed<TableColumn<FinanceAuditEvent>[]>(() => [
  { id: 'created_at', header: t('financeGovernance.audit.columns.time') },
  { id: 'actor', header: t('financeGovernance.audit.columns.actor') },
  { id: 'action', header: t('financeGovernance.audit.columns.action') },
  { id: 'record', header: t('financeGovernance.audit.columns.record') },
  { id: 'fields_written', header: t('financeGovernance.audit.columns.fields') },
  { id: 'outcome', header: t('financeGovernance.audit.columns.outcome') },
])
const dash = computed(() => t('app.notAvailable'))
const time = (event: FinanceAuditEvent) => formatAuditTime(event.created_at, locale.value)
</script>

<template>
  <SharedForbiddenState v-if="!allowed" :description="t('financeGovernance.forbidden')" />
  <SharedListCard v-else>
    <template #filters>
      <SharedFilterBar embedded class="w-full" :active-count="activeCount" :default-open="activeCount > 0" :disabled="!hydrated" @clear="clearFilters">
        <SharedFilterField :label="t('financeGovernance.audit.filters.action')" for="finance-audit-filter-action">
          <USelect id="finance-audit-filter-action" class="w-full md:w-56" :model-value="filters.action ?? 'all'" :items="actionItems" :disabled="!hydrated" @update:model-value="setAction" />
        </SharedFilterField>
        <SharedFilterField :label="t('financeGovernance.audit.filters.dateFrom')" for="finance-audit-filter-from">
          <SharedDateField id="finance-audit-filter-from" :model-value="filters.dateFrom" :max-value="filters.dateTo" :disabled="!hydrated" @update:model-value="setDate('date_from', $event)" />
        </SharedFilterField>
        <SharedFilterField :label="t('financeGovernance.audit.filters.dateTo')" for="finance-audit-filter-to">
          <SharedDateField id="finance-audit-filter-to" :model-value="filters.dateTo" :min-value="filters.dateFrom" :disabled="!hydrated" @update:model-value="setDate('date_to', $event)" />
        </SharedFilterField>
      </SharedFilterBar>
    </template>
    <SharedPageState :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
      <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t(activeCount ? 'app.noResults' : 'financeGovernance.audit.empty')" />
      <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,900px)]">
        <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :loading="query.isPending.value" :caption="t('financeGovernance.audit.title')">
          <template #created_at-cell="{ row }"><bdi class="whitespace-nowrap tabular-nums">{{ time(row.original) }}</bdi></template>
          <template #actor-cell="{ row }">{{ row.original.actor.name }}</template>
          <template #action-cell="{ row }"><SharedStatusBadge size="sm" tone="info" :label="t(`financeGovernance.audit.actions.${row.original.action}`)" /></template>
          <template #record-cell="{ row }"><bdi dir="ltr" class="tabular-nums">{{ row.original.res_model }} #{{ row.original.res_id }}</bdi></template>
          <template #fields_written-cell="{ row }">
            <span v-if="row.original.fields_written.length" class="flex flex-wrap gap-1">
              <SharedStatusBadge v-for="field in row.original.fields_written" :key="field" size="sm" tone="neutral" variant="outline" :label="field" />
            </span>
            <span v-else class="text-muted">{{ dash }}</span>
          </template>
          <template #outcome-cell="{ row }"><bdi v-if="row.original.outcome">{{ row.original.outcome }}</bdi><span v-else class="text-muted">{{ dash }}</span></template>
          <template #mobile-row="{ row }">
            <div class="flex min-w-0 flex-col gap-2">
              <span class="flex items-center justify-between gap-2">
                <SharedStatusBadge size="sm" tone="info" :label="t(`financeGovernance.audit.actions.${row.action}`)" />
                <bdi class="text-sm tabular-nums text-muted">{{ time(row) }}</bdi>
              </span>
              <span class="truncate text-sm text-highlighted">{{ row.actor.name }}</span>
              <bdi dir="ltr" class="text-sm tabular-nums text-muted">{{ row.res_model }} #{{ row.res_id }}</bdi>
              <span v-if="row.fields_written.length" class="flex flex-wrap gap-1">
                <SharedStatusBadge v-for="field in row.fields_written" :key="field" size="sm" tone="neutral" variant="outline" :label="field" />
              </span>
              <bdi v-if="row.outcome" class="text-sm text-muted">{{ row.outcome }}</bdi>
            </div>
          </template>
        </SharedDataTable>
      </div>
    </SharedPageState>
    <template v-if="query.data.value && !showEmpty" #footer>
      <SharedListFooter :count-label="t('financeGovernance.audit.footer', { shown: items.length, total }, total)" :page="filters.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" count-test-id="finance-audit-count" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
    </template>
  </SharedListCard>
</template>
