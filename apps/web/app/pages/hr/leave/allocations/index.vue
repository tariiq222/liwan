<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { useHrLeaveAllocations, type HrLeaveAllocation } from '@/composables/useHrLeave'
import { useHrLeaveFormat } from '@/composables/useHrLeaveFormat'
import { hrLeaveBadge } from '@/utils/hrLeaveBadge'

// The leave balances granted in the companies the caller manages, one page at a time
// (`?offset=`): a row opens the grant, where its days and validity are corrected.
const LIMIT = 25
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const { validity, days } = useHrLeaveFormat()

const offset = computed(() => {
  const parsed = Number(Array.isArray(route.query.offset) ? route.query.offset[0] : route.query.offset)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
})
const allocations = useHrLeaveAllocations(computed(() => ({ limit: LIMIT, offset: offset.value })), computed(() => can('hr.leave.manage')))
const items = computed(() => allocations.data.value?.items ?? [])
const total = computed(() => allocations.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / LIMIT) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / LIMIT)))
const showEmpty = computed(() => !allocations.isLoading.value && !allocations.error.value && items.value.length === 0)
const countTags = computed(() => allocations.data.value ? [{ label: t('hr.leave.allocation.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])

const columns = computed<TableColumn<HrLeaveAllocation>[]>(() => [
  { accessorKey: 'employee', header: t('hr.leave.allocation.employee') },
  { accessorKey: 'leave_type', header: t('hr.leave.form.type') },
  { accessorKey: 'number_of_days', header: t('hr.leave.allocation.days') },
  { accessorKey: 'date_from', header: t('hr.leave.allocation.validity') },
  { accessorKey: 'state', header: t('hr.leave.allocation.state') },
])

function allocationTo(allocation: HrLeaveAllocation) {
  return { path: `/hr/leave/allocations/${allocation.id}`, query: returnToQuery(route.fullPath) }
}

function setPage(next: number) {
  if (!hydrated.value || allocations.isFetching.value || next < 1 || next > pages.value) return
  const nextOffset = (next - 1) * LIMIT
  void router.replace({ query: { ...route.query, offset: nextOffset > 0 ? nextOffset : undefined }, hash: route.hash })
}

const createTo = computed(() => ({ path: '/hr/leave/allocations/new', query: returnToQuery(route.fullPath) }))
</script>

<template>
  <SharedListPage
    :title="t('hr.leave.allocation.listTitle')"
    :tags="countTags"
    back-to="/hr/leave"
    :back-label="t('nav.leave')"
    :create-to="createTo"
    :create-label="t('hr.leave.allocate')"
    create-test-id="hr-allocations-new"
  >
    <SharedForbiddenState v-if="!can('hr.leave.manage')" />
    <SharedListCard v-else>
      <SharedPageState :error="allocations.error.value" :keep-content="items.length > 0" @retry="allocations.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :title="t('hr.leave.allocation.emptyTitle')" :description="t('hr.leave.allocation.emptyHint')" />
        <SharedDataTable
          v-else
          bare
          :rows="items"
          :columns="columns"
          row-key="id"
          :row-to="allocationTo"
          :loading="allocations.isLoading.value"
          :caption="t('hr.leave.allocation.listTitle')"
          data-testid="hr-allocations-table"
        >
          <template #employee-cell="{ row }">
            <NuxtLink :to="allocationTo(row.original)" class="font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" @click="!hydrated && $event.preventDefault()">{{ row.original.employee.name }}</NuxtLink>
          </template>
          <template #leave_type-cell="{ row }">{{ row.original.leave_type.name }}</template>
          <template #number_of_days-cell="{ row }"><span class="tabular-nums">{{ days(row.original.number_of_days) }}</span></template>
          <template #date_from-cell="{ row }"><bdi class="tabular-nums">{{ validity(row.original) }}</bdi></template>
          <template #state-cell="{ row }">
            <SharedStatusBadge size="sm" :tone="hrLeaveBadge(row.original.state).tone" :label="t(hrLeaveBadge(row.original.state).labelKey)" />
          </template>
          <template #mobile-row="{ row }">
            <p class="font-semibold text-highlighted">{{ row.employee.name }}</p>
            <p class="mt-1 text-sm">{{ row.leave_type.name }} · <span class="tabular-nums">{{ days(row.number_of_days) }}</span></p>
            <bdi class="block text-xs text-muted tabular-nums">{{ validity(row) }}</bdi>
          </template>
        </SharedDataTable>
      </SharedPageState>
      <SharedListFooter
        v-if="allocations.data.value && pages > 1"
        :count-label="t('hr.leave.allocation.footer', { shown: items.length, total }, total)"
        :page="page"
        :pages="pages"
        :disabled="allocations.isFetching.value"
        count-test-id="hr-allocations-count"
        @update:page="setPage"
      />
    </SharedListCard>
  </SharedListPage>
</template>
