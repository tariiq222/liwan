<script setup lang="ts">
definePageMeta({ path: '/account/pay' })
import type { TableColumn } from '@nuxt/ui'
import type { HrMyPayslipSummary } from '@webvue/contracts'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { formatPayrollAmount, formatPayrollMonth } from '@/utils/payrollFormat'

// The caller's own approved payslips, newest first: a row opens the printable payslip document.
const route = useRoute()
const { t, locale } = useI18n()
const hydrated = useHydrated()

const profile = useMyHrProfile()
const mine = useMyHrPayslips()
const items = computed(() => mine.data.value?.items ?? [])
const showEmpty = computed(() => !mine.isLoading.value && !mine.error.value && items.value.length === 0)

const columns = computed<TableColumn<HrMyPayslipSummary>[]>(() => [
  { accessorKey: 'month', header: t('hrPayroll.mine.columns.month') },
  { accessorKey: 'number', header: t('hrPayroll.mine.columns.number') },
  { accessorKey: 'net', header: t('hrPayroll.mine.columns.net') },
])
const amount = (value: number) => formatPayrollAmount(value, locale.value)

function payslipTo(row: HrMyPayslipSummary) {
  return { path: `/account/pay/${row.id}`, query: returnToQuery(route.fullPath) }
}
</script>

<template>
  <SharedListPage :title="t('nav.myPayslips')">
    <SharedPageState :loading="profile.isLoading.value" :error="profile.error.value" @retry="profile.refetch">
      <SharedEmptyState v-if="profile.data.value === null" bordered :title="t('hr.self.noEmployee')" :description="t('hr.self.noEmployeeHint')" />
    </SharedPageState>
    <SharedListCard v-if="profile.data.value">
      <SharedPageState :error="mine.error.value" :keep-content="items.length > 0" @retry="mine.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t('hrPayroll.mine.emptyTitle')" :description="t('hrPayroll.mine.emptyHint')" />
        <SharedDataTable
          v-else
          bare
          :rows="items"
          :columns="columns"
          row-key="id"
          :row-to="payslipTo"
          :loading="mine.isLoading.value"
          :caption="t('nav.myPayslips')"
          data-testid="hr-my-payslips-table"
        >
          <template #month-cell="{ row }">
            <NuxtLink :to="payslipTo(row.original)" class="font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" @click="!hydrated && $event.preventDefault()">{{ formatPayrollMonth(row.original.month, locale) }}</NuxtLink>
          </template>
          <template #number-cell="{ row }"><bdi>{{ row.original.number }}</bdi></template>
          <template #net-cell="{ row }"><span class="font-semibold tabular-nums text-highlighted">{{ amount(row.original.net) }} {{ t('hrPayroll.currency') }}</span></template>
          <template #mobile-row="{ row }">
            <p class="font-semibold text-highlighted">{{ formatPayrollMonth(row.month, locale) }}</p>
            <p class="mt-1 text-sm"><bdi>{{ row.number }}</bdi> · {{ amount(row.net) }} {{ t('hrPayroll.currency') }}</p>
          </template>
        </SharedDataTable>
      </SharedPageState>
    </SharedListCard>
  </SharedListPage>
</template>
