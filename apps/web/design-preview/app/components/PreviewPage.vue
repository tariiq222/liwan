<script setup lang="ts">
withDefaults(defineProps<{ title: string; description?: string; width?: 'list' | 'detail' | 'form' }>(), { width: 'list' })
</script>
<template>
  <div class="preview-page" :data-width="width">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0"><h1 class="text-xl font-semibold text-highlighted">{{ title }}</h1><p v-if="description" class="text-muted mt-2 max-w-2xl leading-relaxed">{{ description }}</p></div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2"><slot name="actions" /></div>
    </header>
    <slot />
  </div>
</template>
