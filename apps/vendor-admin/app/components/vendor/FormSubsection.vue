<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>
<template>
  <div class="space-y-3 border-t border-default pt-6 first:border-t-0 first:pt-0">
    <div>
      <h3 class="text-sm font-medium text-highlighted">{{ title }}</h3>
      <p v-if="description" class="text-sm text-muted">{{ description }}</p>
    </div>
    <slot />
  </div>
</template>
