<script setup lang="ts">
import type { BranchSummary } from '@liwan/commercial-contracts'
defineProps<{ summary: BranchSummary }>()
const { t } = useI18n()
</script>
<template>
  <div data-slot="branch-summary">
    <ul class="divide-y divide-default">
      <li class="flex items-center justify-between gap-3 px-(--liwan-card-pad) py-3"><span>{{ t('subscription.branches.hq') }}</span><SharedStatusBadge tone="neutral" variant="subtle" :label="t('subscription.branches.billing.included')" /></li>
      <li v-for="b in summary.items.filter(i => i.kind === 'extra')" :key="b.id" class="flex flex-wrap items-center justify-between gap-3 px-(--liwan-card-pad) py-3" data-testid="branch-row">
        <span class="min-w-0 font-medium">{{ b.name }}</span>
        <span class="flex gap-2"><SharedStatusBadge tone="neutral" variant="outline" :label="t(`subscription.branches.billing.${b.billing}`)" /><SharedStatusBadge :tone="b.state === 'active' ? 'success' : b.state === 'failed' ? 'destructive' : 'neutral'" variant="subtle" :label="t(`subscription.branches.state.${b.state}`)" /></span>
      </li>
    </ul>
    <p class="border-t border-default px-(--liwan-card-pad) py-3 text-sm text-muted tabular-nums">{{ t('subscription.branches.freeUsed', { used: summary.free_extra_used, allowed: summary.free_extra_allowed }, summary.free_extra_allowed) }} · {{ t('subscription.branches.paid', { count: summary.paid }, summary.paid) }}</p>
  </div>
</template>
