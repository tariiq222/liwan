<script setup lang="ts">
definePageMeta({ path: '/account/pay' })
import type { TableColumn } from '@nuxt/ui'
import type { HrMyPayslipSummary } from '@liwan/contracts'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { formatPayrollAmount, formatPayrollMonth, payrollCurrencyLabel } from '@/utils/payrollFormat'

// The caller's own approved payslips, newest first, one page at a time (`?offset=`):
// a row opens the printable payslip document.
const LIMIT = 25
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()

const offset = computed(() => {
  const parsed = Number(Array.isArray(route.query.offset) ? route.query.offset[0] : route.query.offset)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
})
const profile = useMyHrProfile()
const mine = useMyHrPayslips(computed(() => ({ limit: LIMIT, offset: offset.value })))
const items = computed(() => mine.data.value?.items ?? [])
const total = computed(() => mine.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / LIMIT) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / LIMIT)))
const showEmpty = computed(() => !mine.isLoading.value && !mine.error.value && items.value.length === 0)

const columns = computed<TableColumn<HrMyPayslipSummary>[]>(() => [
  { accessorKey: 'month', header: t('hrPayroll.mine.columns.month') },
  { accessorKey: 'number', header: t('hrPayroll.mine.columns.number') },
  { accessorKey: 'net', header: t('hrPayroll.mine.columns.net') },
])
const amount = (value: number) => formatPayrollAmount(value, locale.value)

function setPage(next: number) {
  if (!hydrated.value || mine.isFetching.value || next < 1 || next > pages.value) return
  const nextOffset = (next - 1) * LIMIT
  void router.replace({ query: { ...route.query, offset: nextOffset > 0 ? nextOffset : undefined }, hash: route.hash })
}

function payslipTo(row: HrMyPayslipSummary) {
  return { path: `/account/pay/${row.id}`, query: returnToQuery(route.fullPath) }
}
</script>

<template>
  <SharedListPage :title="t('hr.self.pay')">
    <SharedPageState :loading="profile.isLoading.value" :error="profile.error.value" @retry="profile.refetch">
      <SharedEmptyState v-if="profile.data.value === null" bordered :title="t('hr.self.noEmployee')" :description="t('hr.self.noEmployeeHint')" />
    </SharedPageState>
    <SharedListCard v-if="profile.data.value">
      <SharedPageState :error="mine.error.value" :keep-content="items.length > 0" @retry="mine.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :title="t('hrPayroll.mine.emptyTitle')" :description="t('hrPayroll.mine.emptyHint')" />
        <SharedDataTable
          v-else
          bare
          :rows="items"
          :columns="columns"
          row-key="id"
          :row-to="payslipTo"
          :loading="mine.isLoading.value"
          :caption="t('hr.self.pay')"
          data-testid="hr-my-payslips-table"
        >
          <template #month-cell="{ row }">
            <NuxtLink :to="payslipTo(row.original)" class="font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" @click="!hydrated && $event.preventDefault()">{{ formatPayrollMonth(row.original.month, locale) }}</NuxtLink>
          </template>
          <template #number-cell="{ row }"><bdi>{{ row.original.number }}</bdi></template>
          <template #net-cell="{ row }"><span class="font-semibold tabular-nums text-highlighted">{{ amount(row.original.net) }} {{ payrollCurrencyLabel(row.original.currency, t('hrPayroll.currency')) }}</span></template>
          <template #mobile-row="{ row }">
            <p class="font-semibold text-highlighted">{{ formatPayrollMonth(row.month, locale) }}</p>
            <p class="mt-1 text-sm"><bdi>{{ row.number }}</bdi> · {{ amount(row.net) }} {{ payrollCurrencyLabel(row.currency, t('hrPayroll.currency')) }}</p>
          </template>
        </SharedDataTable>
      </SharedPageState>
      <SharedListFooter
        v-if="mine.data.value && pages > 1"
        :count-label="t('hrPayroll.mine.footer', { shown: items.length, total }, total)"
        :page="page"
        :pages="pages"
        :disabled="mine.isFetching.value"
        count-test-id="hr-my-payslips-count"
        @update:page="setPage"
      />
    </SharedListCard>
  </SharedListPage>
</template>
