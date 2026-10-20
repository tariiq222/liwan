<script setup lang="ts">
import Money from '../invoices/Money.vue'

// A report row on a phone: its name, an optional muted line, and its figures as labelled amounts.
defineProps<{ title: string; subtitle?: string; figures: readonly { label: string; amount: number; currency?: string }[] }>()
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2">
    <span class="min-w-0 font-semibold text-highlighted">{{ title }}</span>
    <span v-if="subtitle" class="min-w-0 truncate text-sm text-muted"><bdi>{{ subtitle }}</bdi></span>
    <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      <div v-for="figure in figures" :key="figure.label" class="flex min-w-0 items-center justify-between gap-2">
        <dt class="text-muted">{{ figure.label }}</dt>
        <dd><Money :amount="figure.amount" :currency="figure.currency" /></dd>
      </div>
    </dl>
  </div>
</template>
