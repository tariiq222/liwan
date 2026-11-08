<script setup lang="ts">
// The large greeting heading of a foundation page («يومي» and «كل التطبيقات»): a display title and one muted line beneath it.
defineProps<{ title: string }>()
</script>

<template>
  <header class="space-y-1.5">
    <h1 class="font-display text-(length:--liwan-fs-greeting) font-bold leading-[1.15] tracking-tight text-highlighted">{{ title }}</h1>
    <p v-if="$slots.default" class="text-[length:1.07rem] text-muted"><slot /></p>
  </header>
</template>
