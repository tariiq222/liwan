<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceAssetDetail } from '@webvue/contracts'
import Money from '../invoices/Money.vue'
import { entryRecordPath } from '../accounting/entryPaths'
import { LINE_TYPE_TONE } from './assetTones'

// The depreciation board of an asset, read-only. It sits beside the properties aside, so the accumulated value is a
// muted second line under the remaining one and the entry link sits under the posted pill.
type BoardLine = FinanceAssetDetail['lines'][number]
const props = defineProps<{ asset: FinanceAssetDetail }>()
const { t } = useI18n()
const numeric = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<BoardLine>[]>(() => [
  { id: 'date', header: t('financeAssets.board.date') },
  { id: 'type', header: t('financeAssets.board.type') },
  { id: 'amount', header: t('financeAssets.board.amount'), meta: numeric },
  { id: 'remaining_value', header: t('financeAssets.board.remaining'), meta: numeric },
  { id: 'posted', header: t('financeAssets.board.posted') },
])
</script>

<template>
  <SharedRecordSection variant="list" :title="t('financeAssets.board.title')" data-testid="finance-asset-board">
    <SharedDataTable bare :rows="asset.lines" :columns="columns" row-key="id" :caption="t('financeAssets.board.title')">
      <template #date-cell="{ row }"><bdi class="tabular-nums">{{ row.original.date }}</bdi></template>
      <template #type-cell="{ row }"><SharedStatusBadge size="sm" :tone="LINE_TYPE_TONE[row.original.type]" :label="t(`financeAssets.board.types.${row.original.type}`)" /></template>
      <template #amount-cell="{ row }"><Money :amount="row.original.amount" :currency="props.asset.currency" /></template>
      <template #remaining_value-cell="{ row }">
        <Money :amount="row.original.remaining_value" />
        <p class="text-xs text-muted">{{ t('financeAssets.board.accumulated') }}: <Money :amount="row.original.depreciated_value" /></p>
      </template>
      <template #posted-cell="{ row }">
        <SharedStatusBadge size="sm" :tone="row.original.posted ? 'success' : 'neutral'" :label="t(row.original.posted ? 'financeAssets.board.postedYes' : 'financeAssets.board.postedNo')" />
        <NuxtLink v-if="row.original.entry" :to="entryRecordPath(row.original.entry.id)" class="mt-1 block text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><bdi>{{ row.original.entry.name }}</bdi></NuxtLink>
      </template>
      <template #mobile-row="{ row }">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="flex items-center gap-2">
              <bdi class="tabular-nums font-semibold text-highlighted">{{ row.date }}</bdi>
              <SharedStatusBadge size="sm" :tone="LINE_TYPE_TONE[row.type]" :label="t(`financeAssets.board.types.${row.type}`)" />
            </p>
            <p class="text-sm text-muted">{{ t('financeAssets.board.remaining') }}: <Money :amount="row.remaining_value" /></p>
            <NuxtLink v-if="row.entry" :to="entryRecordPath(row.entry.id)" class="text-xs text-primary hover:underline"><bdi>{{ row.entry.name }}</bdi></NuxtLink>
          </div>
          <div class="text-end">
            <Money :amount="row.amount" :currency="props.asset.currency" />
            <SharedStatusBadge size="sm" :tone="row.posted ? 'success' : 'neutral'" :label="t(row.posted ? 'financeAssets.board.postedYes' : 'financeAssets.board.postedNo')" />
          </div>
        </div>
      </template>
    </SharedDataTable>
  </SharedRecordSection>
</template>
