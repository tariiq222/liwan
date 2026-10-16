<script setup lang="ts">
// A short list of labelled rows, each with a value and an optional bar (a share from 0 to 1) and a link.
// The analytics page uses it for the ageing buckets, subscription states, plans, renewals, limits and stalled orders.
export interface RankedRow { id: string, label: string, value: string, share?: number, hint?: string, to?: string, tone?: 'primary' | 'warning' | 'error' }
const props = defineProps<{ rows: readonly RankedRow[], emptyText: string }>()
</script>

<template>
  <p v-if="!props.rows.length" class="py-6 text-center text-sm text-muted" data-testid="ranked-empty">{{ props.emptyText }}</p>
  <ul v-else class="divide-y divide-default" data-testid="ranked-list">
    <li v-for="row in props.rows" :key="row.id" class="grid gap-1.5 py-2.5 first:pt-0 last:pb-0">
      <div class="flex items-baseline justify-between gap-3">
        <NuxtLink v-if="row.to" :to="row.to" class="min-w-0 truncate text-sm font-medium text-highlighted hover:underline focus-visible:outline-2 focus-visible:outline-primary">{{ row.label }}</NuxtLink>
        <span v-else class="min-w-0 truncate text-sm text-default">{{ row.label }}</span>
        <span class="shrink-0 text-sm font-semibold tabular-nums text-highlighted" dir="ltr">{{ row.value }}</span>
      </div>
      <UProgress v-if="row.share !== undefined" :model-value="Math.round(Math.min(1, row.share) * 100)" size="xs" :color="row.tone ?? 'primary'" :aria-label="row.label" />
      <p v-if="row.hint" class="text-xs text-muted">{{ row.hint }}</p>
    </li>
  </ul>
</template>
