<script setup lang="ts">
import type { Quote } from '@webvue/commercial-contracts'
import type { InvoiceLineView } from '../../../utils/invoiceLines'
import { cadenceLabel, formatCommercialMoney, quoteLinesByTiming } from '../../../utils/commercial'
const props = defineProps<{ quote?: Quote | null; pending?: boolean; error?: string; includedExtraBranches?: number; hqIncluded?: boolean }>()
defineEmits<{ retry: [] }>()
const { t, locale } = useI18n()
const money = (m: Quote['due_now']) => formatCommercialMoney(m, locale.value)
const now = computed(() => (props.quote ? quoteLinesByTiming(props.quote, 'now') : []))
const renewal = computed(() => (props.quote ? quoteLinesByTiming(props.quote, 'renewal') : []))
const branchLines = computed(() => (props.quote?.lines ?? []).filter(l => l.kind === 'branch' && l.timing === 'now'))
const paid = computed(() => branchLines.value.reduce((n, l) => n + l.quantity, 0))
const freeBranches = computed(() => Math.max(0, (props.quote?.requested_extra_branches ?? 0) - paid.value))

const lines = computed<InvoiceLineView[]>(() => [
  ...(props.hqIncluded !== false ? [{ id: 'hq-included', description: t('commercial.pricing.quote.hq'), cells: [], amount: t('commercial.pricing.summary.included') }] : []),
  ...now.value.map(line => ({ id: line.key, description: line.description, cells: line.quantity > 1 ? [{ key: 'quantity', label: '', value: `× ${line.quantity}` }] : [], amount: money(line.amount) })),
])
const totals = computed(() => props.quote ? [
  { label: t('commercial.pricing.quote.dueNow'), value: money(props.quote.due_now) },
  { label: `${t('commercial.pricing.quote.nextRenewal')} · ${props.quote.next_renewal_at}`, value: money(props.quote.next_renewal) },
] : [])
</script>
<template>
  <div class="space-y-4" data-slot="price-breakdown" :aria-busy="pending ? 'true' : 'false'">
    <p v-if="pending && quote && !error" role="status" class="text-sm text-muted">{{ t('commercial.pricing.quote.loading') }}</p>
    <UAlert v-if="error" color="error" variant="subtle" :ui="{ title: 'text-default' }" :title="error"><template #actions><UButton color="neutral" variant="outline" size="sm" @click="$emit('retry')">{{ t('commercial.pricing.retry') }}</UButton></template></UAlert>
    <p v-else-if="pending && !quote" class="text-sm text-muted">{{ t('commercial.pricing.quote.loading') }}</p>
    <p v-else-if="!quote" class="text-sm text-muted">{{ t('commercial.pricing.quote.empty') }}</p>
    <template v-else>
      <p class="text-sm text-muted">{{ t('commercial.pricing.quote.cadence') }}: {{ cadenceLabel(quote.cadence, t) }}</p>
      <SharedInvoiceLines layout="list" :lines="lines" :totals="totals" />
      <p v-if="quote.requested_extra_branches > 0" class="text-sm text-muted tabular-nums">{{ t('commercial.pricing.quote.branches', { free: t('commercial.pricing.quote.branchesFree', { count: freeBranches }, freeBranches), paid: t('commercial.pricing.quote.branchesPaid', { count: paid }, paid) }) }}</p>
      <p class="text-xs text-muted">{{ t('commercial.pricing.quote.vatNote') }}</p>
      <details v-if="renewal.length" class="text-sm"><summary class="cursor-pointer text-muted">{{ t('commercial.pricing.quote.renewalLines') }}</summary>
        <ul class="mt-2 space-y-1"><li v-for="line in renewal" :key="line.key" class="flex justify-between gap-3"><span>{{ line.description }}</span><span class="tabular-nums">{{ money(line.amount) }}</span></li></ul>
      </details>
    </template>
  </div>
</template>
