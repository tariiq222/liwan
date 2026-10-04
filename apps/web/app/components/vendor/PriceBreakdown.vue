<script setup lang="ts">
import type { Quote } from '@nasq/commercial-contracts'
import { cadenceLabel, formatVendorMoney, quoteLinesByTiming } from '@/utils/vendorCommercial'
const props = defineProps<{ quote?: Quote | null; pending?: boolean; error?: string; includedExtraBranches?: number; hqIncluded?: boolean }>()
defineEmits<{ retry: [] }>()
const { t, locale } = useI18n()
const money = (m: Quote['due_now']) => formatVendorMoney(m, locale.value)
const now = computed(() => (props.quote ? quoteLinesByTiming(props.quote, 'now') : []))
const renewal = computed(() => (props.quote ? quoteLinesByTiming(props.quote, 'renewal') : []))
const branchLines = computed(() => (props.quote?.lines ?? []).filter(l => l.kind === 'branch' && l.timing === 'now'))
const paid = computed(() => branchLines.value.reduce((n, l) => n + l.quantity, 0))
const freeBranches = computed(() => Math.max(0, (props.quote?.requested_extra_branches ?? 0) - paid.value))

</script>
<template>
  <div class="space-y-4" data-slot="price-breakdown" :aria-busy="pending ? 'true' : 'false'">
    <UAlert v-if="error" color="error" variant="subtle" :title="error"><template #actions><UButton color="neutral" variant="outline" size="sm" @click="$emit('retry')">{{ t('vendor.pricing.retry') }}</UButton></template></UAlert>
    <p v-else-if="pending && !quote" class="text-sm text-muted">{{ t('vendor.pricing.quote.loading') }}</p>
    <p v-else-if="!quote" class="text-sm text-muted">{{ t('vendor.pricing.quote.empty') }}</p>
    <template v-else>
      <p class="text-sm text-muted">{{ t('vendor.pricing.quote.cadence') }}: {{ cadenceLabel(quote.cadence, t) }}</p>
      <ul class="divide-y divide-default rounded-lg ring ring-default" :class="{ 'opacity-60': pending }">
        <li v-if="hqIncluded !== false" class="flex items-center justify-between gap-3 p-3"><span>{{ t('vendor.pricing.quote.hq') }}</span><span class="text-sm text-muted">{{ t('vendor.pricing.summary.included') }}</span></li>
        <li v-for="line in now" :key="line.key" class="flex items-center justify-between gap-3 p-3">
          <span class="min-w-0"><span>{{ line.description }}</span><span v-if="line.quantity > 1" class="ms-2 text-xs text-muted tabular-nums">× {{ line.quantity }}</span></span>
          <span class="font-medium tabular-nums">{{ money(line.amount) }}</span>
        </li>
      </ul>
      <p v-if="quote.requested_extra_branches > 0" class="text-sm text-muted tabular-nums">{{ t('vendor.pricing.quote.branches', { free: freeBranches, paid }) }}</p>
      <dl class="space-y-2 rounded-lg bg-elevated p-3">
        <div class="flex justify-between gap-3"><dt class="font-semibold">{{ t('vendor.pricing.quote.dueNow') }}</dt><dd class="font-semibold tabular-nums">{{ money(quote.due_now) }}</dd></div>
        <div class="flex justify-between gap-3"><dt class="text-muted">{{ t('vendor.pricing.quote.nextRenewal') }} · <bdi dir="ltr">{{ quote.next_renewal_at }}</bdi></dt><dd class="tabular-nums">{{ money(quote.next_renewal) }}</dd></div>
        <p class="text-xs text-muted">{{ t('vendor.pricing.quote.vatNote') }}</p>
      </dl>
      <details v-if="renewal.length" class="text-sm"><summary class="cursor-pointer text-muted">{{ t('vendor.pricing.quote.renewalLines') }}</summary>
        <ul class="mt-2 space-y-1"><li v-for="line in renewal" :key="line.key" class="flex justify-between gap-3"><span>{{ line.description }}</span><span class="tabular-nums">{{ money(line.amount) }}</span></li></ul>
      </details>
    </template>
  </div>
</template>
