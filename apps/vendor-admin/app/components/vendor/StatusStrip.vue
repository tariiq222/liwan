<script setup lang="ts">
import type { StatusStat } from '@/utils/vendorAttention'
const NuxtLink = resolveComponent('NuxtLink')
defineProps<{ stats: readonly StatusStat[], label: string }>()
</script>
<template>
  <nav :aria-label="label" data-slot="status-strip">
    <ul class="flex flex-wrap gap-2">
      <li v-for="stat in stats" :key="stat.id">
        <component :is="stat.to ? NuxtLink : 'div'" :to="stat.to" class="flex items-baseline gap-2 rounded-lg px-3 py-2 ring ring-default focus-visible:outline-2 focus-visible:outline-primary" :class="stat.to ? 'hover:bg-elevated' : ''" :data-testid="`status-${stat.id}`">
          <span class="text-lg font-semibold tabular-nums text-highlighted">{{ stat.value }}</span>
          <span class="text-sm text-muted">{{ stat.label }}</span>
        </component>
      </li>
    </ul>
  </nav>
</template>
