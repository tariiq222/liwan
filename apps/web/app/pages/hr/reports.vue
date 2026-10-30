<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { HrExpiringItem, HrSaudizationRow } from '@liwan/contracts'
import { HR_EXPIRY_WINDOWS, hrExpiryWindowFrom, useHrExpiring, useHrSaudization } from '@/composables/useHrReports'
import { hrExpiryTone } from '@/utils/hrExpiryBadge'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t, n } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const { shown: kpisShown } = useKpiVisibility()

const forbidden = computed(() => !can('hr.employees.manage'))
const recordLink = useRecordLink()
const withinDays = computed(() => hrExpiryWindowFrom(route.query.within))
const saudization = useHrSaudization(computed(() => !forbidden.value))
const expiring = useHrExpiring(withinDays, computed(() => !forbidden.value))

// Saudization: the headline tiles and the same counts per department. A department of null holds the
// employees without one; unknown nationalities stay out of the rate.
const overall = computed(() => saudization.data.value?.overall)
const departments = computed(() => saudization.data.value?.items ?? [])
function rate(percent: number | null) { return percent === null ? null : n(percent, { maximumFractionDigits: 1 }) }
function rateLabel(percent: number | null) { return percent === null ? t('app.notAvailable') : `${rate(percent)}%` }
function departmentName(row: HrSaudizationRow) { return row.department?.name ?? t('hr.reports.saudization.noDepartment') }
const saudizationColumns = computed<TableColumn<HrSaudizationRow>[]>(() => [
  { id: 'department', header: t('hr.reports.saudization.columns.department') },
  { id: 'total', header: t('hr.reports.saudization.columns.total') },
  { id: 'saudi', header: t('hr.reports.saudization.columns.saudi') },
  { id: 'non_saudi', header: t('hr.reports.saudization.columns.nonSaudi') },
  { id: 'unknown', header: t('hr.reports.saudization.columns.unknown') },
  { id: 'rate', header: t('hr.reports.saudization.columns.rate') },
])

// Expiring items: the employee name opens the employee (back to this report), the document name opens the
// linked document for a reader of it. A negative `days_left` is overdue.
const items = computed(() => expiring.data.value?.items ?? [])
const showEmpty = computed(() => !expiring.isLoading.value && !expiring.error.value && items.value.length === 0)
const LINK = 'font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
const expiringColumns = computed<TableColumn<HrExpiringItem>[]>(() => [
  { id: 'employee', header: t('hr.reports.expiring.columns.employee') },
  { id: 'kind', header: t('hr.reports.expiring.columns.kind') },
  { id: 'document', header: t('hr.reports.expiring.columns.document') },
  { id: 'due_date', header: t('hr.reports.expiring.columns.due') },
  { id: 'days_left', header: t('hr.reports.expiring.columns.status') },
])
function expiringKey(item: HrExpiringItem) {
  return `${item.kind}:${item.employee?.id ?? 0}:${item.document?.id ?? 0}:${item.due_date}`
}
function employeeTo(id: number) { return { path: `/hr/employees/${id}`, query: returnToQuery(route.fullPath) } }
function statusLabel(daysLeft: number) {
  if (daysLeft === 0) return t('hr.reports.expiring.today')
  const count = Math.abs(daysLeft)
  return t(daysLeft < 0 ? 'hr.reports.expiring.overdue' : 'hr.reports.expiring.daysLeft', { count: n(count) }, count)
}

// The first window is the default and the bare URL; the others are written as ?within=.
const windowItems = computed(() => HR_EXPIRY_WINDOWS.map(days => ({
  value: String(days),
  label: t('hr.reports.expiring.window', { days: n(days) }),
  testId: `hr-expiring-window-${days}`,
})))
function setWindow(value: string) {
  if (!hydrated.value) return
  const days = hrExpiryWindowFrom(value)
  void router.replace({ query: { ...route.query, within: days === HR_EXPIRY_WINDOWS[0] ? undefined : days }, hash: route.hash })
}
</script>

<template>
  <SharedListPage :title="t('hr.reports.title')" :kpi-toggle="!forbidden">
    <SharedForbiddenState v-if="forbidden" :description="t('hr.reports.forbidden')" />
    <div v-else class="liwan-page-stack">
      <SharedRecordSection :title="t('hr.reports.saudization.title')" data-testid="hr-saudization">
        <SharedPageState :loading="saudization.isLoading.value" :error="saudization.error.value" @retry="saudization.refetch">
          <div v-if="overall" class="liwan-page-stack">
            <div v-if="kpisShown" class="grid gap-(--liwan-gap-card) sm:grid-cols-2 xl:grid-cols-4" data-testid="hr-saudization-tiles">
              <SharedMetricTile
                icon="i-lucide-chart-pie"
                :label="t('hr.reports.saudization.rate')"
                :value="rate(overall.saudi_percent)"
                :unit="overall.saudi_percent === null ? undefined : '%'"
                :hint="t('hr.reports.saudization.rateHint')"
                :progress="overall.saudi_percent ?? undefined"
                value-dir="ltr"
                tone="success"
              />
              <SharedMetricTile icon="i-lucide-user-check" :label="t('hr.reports.saudization.saudi')" :value="n(overall.saudi)" value-dir="ltr" />
              <SharedMetricTile icon="i-lucide-users" :label="t('hr.reports.saudization.nonSaudi')" :value="n(overall.non_saudi)" value-dir="ltr" />
              <SharedMetricTile
                icon="i-lucide-user-round-search"
                :label="t('hr.reports.saudization.unknown')"
                :value="n(overall.unknown)"
                :hint="t('hr.reports.saudization.unknownHint')"
                value-dir="ltr"
                :tone="overall.unknown > 0 ? 'warning' : 'neutral'"
              />
            </div>
            <SharedListCard>
              <SharedEmptyState v-if="!departments.length" class="m-(--liwan-card-pad-dense)" :title="t('hr.reports.saudization.empty')" />
              <SharedDataTable
                v-else
                bare
                data-testid="hr-saudization-table"
                :rows="departments"
                :columns="saudizationColumns"
                :row-key="row => row.department?.id ?? 0"
                :caption="t('hr.reports.saudization.byDepartment')"
              >
                <template #department-cell="{ row }"><span class="font-semibold text-highlighted">{{ departmentName(row.original) }}</span></template>
                <template #total-cell="{ row }"><span class="tabular-nums">{{ n(row.original.total) }}</span></template>
                <template #saudi-cell="{ row }"><span class="tabular-nums">{{ n(row.original.saudi) }}</span></template>
                <template #non_saudi-cell="{ row }"><span class="tabular-nums">{{ n(row.original.non_saudi) }}</span></template>
                <template #unknown-cell="{ row }"><span class="tabular-nums">{{ n(row.original.unknown) }}</span></template>
                <template #rate-cell="{ row }">
                  <div class="flex items-center gap-2">
                    <SharedProgress class="min-w-24 flex-1" :value="row.original.saudi_percent" tone="success" :label="t('hr.reports.saudization.rateFor', { name: departmentName(row.original) })" />
                    <bdi class="w-12 text-end tabular-nums">{{ rateLabel(row.original.saudi_percent) }}</bdi>
                  </div>
                </template>
                <template #mobile-row="{ row }">
                  <p class="font-semibold text-highlighted">{{ departmentName(row) }}</p>
                  <SharedProgress class="mt-2" :value="row.saudi_percent" tone="success" :label="t('hr.reports.saudization.rateFor', { name: departmentName(row) })" />
                  <p class="mt-1 text-xs text-muted tabular-nums">
                    {{ t('hr.reports.saudization.columns.saudi') }} {{ n(row.saudi) }} · {{ t('hr.reports.saudization.columns.nonSaudi') }} {{ n(row.non_saudi) }} · {{ t('hr.reports.saudization.columns.unknown') }} {{ n(row.unknown) }}
                  </p>
                </template>
              </SharedDataTable>
            </SharedListCard>
          </div>
        </SharedPageState>
      </SharedRecordSection>

      <SharedRecordSection :title="t('hr.reports.expiring.title')" data-testid="hr-expiring">
        <SharedListCard>
          <template #filters>
            <SharedSegmentedControl
              :model-value="String(withinDays)"
              :items="windowItems"
              :label="t('hr.reports.expiring.windowLabel')"
              :disabled="!hydrated"
              @update:model-value="setWindow"
            />
          </template>
          <SharedPageState :loading="expiring.isLoading.value" :error="expiring.error.value" :keep-content="items.length > 0" @retry="expiring.refetch">
            <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :title="t('hr.reports.expiring.empty')" />
            <SharedDataTable
              v-else-if="items.length"
              bare
              data-testid="hr-expiring-table"
              :rows="items"
              :columns="expiringColumns"
              :row-key="expiringKey"
              :caption="t('hr.reports.expiring.caption')"
            >
              <template #employee-cell="{ row }">
                <NuxtLink v-if="row.original.employee" :to="employeeTo(row.original.employee.id)" :class="LINK" @click="!hydrated && $event.preventDefault()">{{ row.original.employee.name }}</NuxtLink>
                <span v-else class="text-muted">{{ t('app.notAvailable') }}</span>
              </template>
              <template #kind-cell="{ row }">{{ t(`hr.reports.expiring.kind.${row.original.kind}`) }}</template>
              <template #document-cell="{ row }">
                <template v-if="row.original.document">
                  <NuxtLink v-if="recordLink('document', row.original.document.id)" :to="recordLink('document', row.original.document.id)!" :class="LINK" @click="!hydrated && $event.preventDefault()">{{ row.original.document.name }}</NuxtLink>
                  <span v-else>{{ row.original.document.name }}</span>
                </template>
                <span v-else class="text-muted">{{ t('app.notAvailable') }}</span>
              </template>
              <template #due_date-cell="{ row }"><bdi class="tabular-nums">{{ row.original.due_date }}</bdi></template>
              <template #days_left-cell="{ row }">
                <SharedStatusBadge size="sm" :tone="hrExpiryTone(row.original.days_left)" :label="statusLabel(row.original.days_left)" />
              </template>
              <template #mobile-row="{ row }">
                <div class="flex items-center justify-between gap-2">
                  <NuxtLink v-if="row.employee" :to="employeeTo(row.employee.id)" :class="LINK" @click="!hydrated && $event.preventDefault()">{{ row.employee.name }}</NuxtLink>
                  <SharedStatusBadge size="sm" :tone="hrExpiryTone(row.days_left)" :label="statusLabel(row.days_left)" />
                </div>
                <p class="mt-1 text-sm">{{ t(`hr.reports.expiring.kind.${row.kind}`) }}<template v-if="row.document"> · {{ row.document.name }}</template></p>
                <bdi class="block text-xs text-muted tabular-nums">{{ row.due_date }}</bdi>
              </template>
            </SharedDataTable>
          </SharedPageState>
          <template v-if="expiring.data.value && !showEmpty" #footer>
            <SharedListFooter :count-label="t('hr.reports.expiring.footer', { count: n(expiring.data.value.total) }, expiring.data.value.total)" :page="1" :pages="1" />
          </template>
        </SharedListCard>
      </SharedRecordSection>
    </div>
  </SharedListPage>
</template>
