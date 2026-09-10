<script setup lang="ts">
const props = defineProps<{ value: number; label: string }>()
const percent = computed(() => Number.isFinite(props.value) ? Math.min(100, Math.max(0, props.value)) : 0)
</script>
<template>
  <UProgress class="preview-progress" :model-value="percent" :get-value-label="() => label" :style="{ '--preview-progress': `${percent}%` }" />
</template>
