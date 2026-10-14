<script setup lang="ts">
const props = defineProps<{ state: string }>()
const { t } = useI18n()
const colors: Record<string, 'neutral' | 'warning' | 'success' | 'error' | 'info'> = { draft: 'neutral', waiting: 'neutral', pending: 'info', returned: 'warning', rejected: 'error', withdrawn: 'neutral', done: 'success', approved: 'success', published: 'success', archived: 'neutral' }
</script>
<template><UBadge :color="colors[props.state] ?? 'neutral'" variant="subtle">{{ t(`operations.states.${props.state}`) }}</UBadge></template>
