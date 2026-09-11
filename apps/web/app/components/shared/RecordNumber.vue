<script setup lang="ts">
const props = defineProps<{ value?: string | number | null }>()
const displayValue = computed(() => {
  if (typeof props.value === 'number') return Number.isFinite(props.value) ? String(props.value) : '—'
  return props.value?.trim() || '—'
})
</script>

<template>
  <bdi data-slot="record-number" dir="ltr" class="inline-block whitespace-nowrap font-mono text-xs tabular-nums text-muted">{{ displayValue }}</bdi>
</template>
