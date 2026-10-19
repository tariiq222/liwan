<script setup lang="ts">
import { formatAmount } from './formatAmount'

// One amount: tabular figures, the currency code after it, never split across lines.
defineProps<{ amount: number; currency?: string }>()
</script>

<template>
  <span class="whitespace-nowrap tabular-nums"><bdi>{{ formatAmount(amount) }}</bdi><span v-if="currency" class="ms-1 text-muted">{{ currency }}</span></span>
</template>
