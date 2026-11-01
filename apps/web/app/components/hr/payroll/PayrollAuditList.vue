<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { HR_PAYROLL_AUDIT_ACTIONS, type HrPayrollAuditEvent } from '@liwan/contracts'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { useHrPayrollAuditEvents } from '@/composables/useHrPayrollAudit'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import {
  PAYROLL_AUDIT_PAGE_SIZE, PAYROLL_AUDIT_PATH, formatPayrollAuditTime, payrollAuditActiveFilterCount, payrollAuditFiltersFromQuery, payrollAuditParams,
} from './payrollAuditParams'

// The read-only list of the payroll audit trail. The page owns the settings shell and heading.
const { t, locale } = useI18n()
const { can } = useAccess()
const allowed = computed(() => can('hr.payroll.audit.read'))
const { hydrated, filterQuery, update } = useRouteListFilters({
  fallbackPath: () => PAYROLL_AUDIT_PATH,
  safeReturnTo: (value, fallback) => safeReturnTo(value, fallback, [PAYROLL_AUDIT_PATH]),
})
const filters = computed(() => payrollAuditFiltersFromQuery(filterQuery.value))
const activeCount = computed(() => payrollAuditActiveFilterCount(filters.value))
const query = useHrPayrollAuditEvents(() => payrollAuditParams(filters.value), allowed)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAYROLL_AUDIT_PAGE_SIZE)))
const showEmpty = computed(() => !query.isPending.value && !query.error.value && items.value.length === 0)

const actionItems = computed(() => [
  { value: 'all', label: t('hrPayroll.audit.filters.allActions') },
  ...HR_PAYROLL_AUDIT_ACTIONS.map(action => ({ value: action, label: t(`hrPayroll.audit.actions.${action}`) })),
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

const columns = computed<TableColumn<HrPayrollAuditEvent>[]>(() => [
  { id: 'created_at', header: t('hrPayroll.audit.columns.time') },
  { id: 'actor', header: t('hrPayroll.audit.columns.actor') },
  { id: 'action', header: t('hrPayroll.audit.columns.action') },
  { id: 'record', header: t('hrPayroll.audit.columns.record') },
  { id: 'changes', header: t('hrPayroll.audit.columns.changes') },
])
const dash = computed(() => t('app.notAvailable'))
const time = (event: HrPayrollAuditEvent) => formatPayrollAuditTime(event.created_at, locale.value)
// A secret field (pay, IBAN) carries its name alone; a policy field shows old and new value.
function changeText(change: HrPayrollAuditEvent['changes'][number]) {
  return change.old_value === null && change.new_value === null
    ? change.field
    : t('hrPayroll.audit.change', { field: change.field, from: change.old_value ?? dash.value, to: change.new_value ?? dash.value })
}
</script>

<template>
  <SharedForbiddenState v-if="!allowed" :description="t('hrPayroll.audit.forbidden')" />
  <SharedListCard v-else>
    <template #filters>
      <SharedFilterBar embedded class="w-full" :active-count="activeCount" :default-open="activeCount > 0" :disabled="!hydrated" @clear="clearFilters">
        <SharedFilterField :label="t('hrPayroll.audit.filters.action')" for="hr-payroll-audit-filter-action">
          <USelect id="hr-payroll-audit-filter-action" class="w-full md:w-56" :model-value="filters.action ?? 'all'" :items="actionItems" :disabled="!hydrated" @update:model-value="setAction" />
        </SharedFilterField>
        <SharedFilterField :label="t('hrPayroll.audit.filters.dateFrom')" for="hr-payroll-audit-filter-from">
          <SharedDateField id="hr-payroll-audit-filter-from" :model-value="filters.dateFrom" :max-value="filters.dateTo" :disabled="!hydrated" @update:model-value="setDate('date_from', $event)" />
        </SharedFilterField>
        <SharedFilterField :label="t('hrPayroll.audit.filters.dateTo')" for="hr-payroll-audit-filter-to">
          <SharedDateField id="hr-payroll-audit-filter-to" :model-value="filters.dateTo" :min-value="filters.dateFrom" :disabled="!hydrated" @update:model-value="setDate('date_to', $event)" />
        </SharedFilterField>
      </SharedFilterBar>
    </template>
    <SharedPageState :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
      <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :title="t(activeCount ? 'app.noResults' : 'hrPayroll.audit.empty')" />
      <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,900px)]">
        <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :loading="query.isPending.value" :caption="t('hrPayroll.audit.title')">
          <template #created_at-cell="{ row }"><bdi class="whitespace-nowrap tabular-nums">{{ time(row.original) }}</bdi></template>
          <template #actor-cell="{ row }">{{ row.original.actor.name }}</template>
          <template #action-cell="{ row }"><SharedStatusBadge size="sm" tone="info" :label="t(`hrPayroll.audit.actions.${row.original.action}`)" /></template>
          <template #record-cell="{ row }"><bdi dir="ltr" class="tabular-nums">{{ row.original.res_model }} #{{ row.original.res_id }}</bdi></template>
          <template #changes-cell="{ row }">
            <span v-if="row.original.changes.length" class="flex flex-wrap gap-1">
              <SharedStatusBadge v-for="change in row.original.changes" :key="change.field" size="sm" tone="neutral" variant="outline" :label="changeText(change)" />
            </span>
            <span v-else class="text-muted">{{ dash }}</span>
          </template>
          <template #mobile-row="{ row }">
            <div class="flex min-w-0 flex-col gap-2">
              <span class="flex items-center justify-between gap-2">
                <SharedStatusBadge size="sm" tone="info" :label="t(`hrPayroll.audit.actions.${row.action}`)" />
                <bdi class="text-sm tabular-nums text-muted">{{ time(row) }}</bdi>
              </span>
              <span class="truncate text-sm text-highlighted">{{ row.actor.name }}</span>
              <bdi dir="ltr" class="text-sm tabular-nums text-muted">{{ row.res_model }} #{{ row.res_id }}</bdi>
              <span v-if="row.changes.length" class="flex flex-wrap gap-1">
                <SharedStatusBadge v-for="change in row.changes" :key="change.field" size="sm" tone="neutral" variant="outline" :label="changeText(change)" />
              </span>
            </div>
          </template>
        </SharedDataTable>
      </div>
    </SharedPageState>
    <template v-if="query.data.value && !showEmpty" #footer>
      <SharedListFooter :count-label="t('hrPayroll.audit.footer', { shown: items.length, total }, total)" :page="filters.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" count-test-id="hr-payroll-audit-count" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
    </template>
  </SharedListCard>
</template>
