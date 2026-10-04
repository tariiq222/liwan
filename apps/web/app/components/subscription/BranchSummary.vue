<script setup lang="ts">
import type { BranchSummary } from '@nasq/commercial-contracts'
defineProps<{ summary: BranchSummary }>()
const { t } = useI18n()
</script>
<template>
  <div class="space-y-3" data-slot="branch-summary">
    <ul class="divide-y divide-default rounded-lg ring ring-default">
      <li class="flex items-center justify-between gap-3 p-3"><span>{{ t('subscription.branches.hq') }}</span><UBadge color="neutral" variant="subtle">{{ t('subscription.branches.billing.included') }}</UBadge></li>
      <li v-for="b in summary.items.filter(i => i.kind === 'extra')" :key="b.id" class="flex flex-wrap items-center justify-between gap-3 p-3" data-testid="branch-row">
        <span class="min-w-0 font-medium">{{ b.name }}</span>
        <span class="flex gap-2"><UBadge color="neutral" variant="outline">{{ t(`subscription.branches.billing.${b.billing}`) }}</UBadge><UBadge :color="b.state === 'active' ? 'success' : b.state === 'failed' ? 'error' : 'neutral'" variant="subtle">{{ t(`subscription.branches.state.${b.state}`) }}</UBadge></span>
      </li>
    </ul>
    <p class="text-sm text-muted tabular-nums">{{ t('subscription.branches.freeUsed', { used: summary.free_extra_used, allowed: summary.free_extra_allowed }) }} · {{ t('subscription.branches.paid', { count: summary.paid }) }}</p>
  </div>
</template>
