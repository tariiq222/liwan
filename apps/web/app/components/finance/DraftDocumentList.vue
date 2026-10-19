<script setup lang="ts">
import type { FinanceInvoice } from '@webvue/contracts'
import { invoiceRecordPath } from '@/modules/finance/routes'

// Draft documents waiting to be posted, newest first: the "needs attention" list of the overview. The page owns the query.
defineProps<{ rows: FinanceInvoice[] }>()
const { t, n } = useI18n()
</script>

<template>
  <NuxtLink
    v-for="row in rows"
    :key="row.id"
    :to="invoiceRecordPath(row.move_type, row.id)"
    data-testid="finance-draft-row"
    class="flex items-center justify-between gap-3 px-(--webvue-card-pad) py-3 text-sm transition-colors duration-150 hover:bg-(--webvue-row-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
  >
    <span class="min-w-0">
      <span class="block truncate font-medium text-highlighted">{{ row.name ?? t('finance.overview.draftUnnumbered') }}</span>
      <span class="block truncate text-xs text-muted">{{ [t(`finance.overview.moveType.${row.move_type}`), row.partner?.name].filter(Boolean).join(' · ') }}</span>
    </span>
    <bdi dir="ltr" class="shrink-0 font-medium text-highlighted">{{ n(row.amount_total, { style: 'currency', currency: row.currency }) }}</bdi>
  </NuxtLink>
</template>
