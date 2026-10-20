<script setup lang="ts">
import Money from '../invoices/Money.vue'

// The totals line under a report table (the table's footer slot): labelled amounts the server reported for the whole report.
defineProps<{ items: readonly { label: string; amount: number; currency?: string }[] }>()
</script>

<template>
  <dl class="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1">
    <div v-for="item in items" :key="item.label" class="flex items-center gap-2">
      <dt class="text-muted">{{ item.label }}</dt>
      <dd class="font-semibold text-highlighted"><Money :amount="item.amount" :currency="item.currency" /></dd>
    </div>
    <slot />
  </dl>
</template>
