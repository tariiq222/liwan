<script setup lang="ts">
defineProps<{
  title?: string
  description?: string
  panel?: boolean
}>()
</script>

<template>
  <UCard v-if="panel">
    <template v-if="title || description" #header>
      <h2 v-if="title" class="text-lg font-semibold text-highlighted">{{ title }}</h2>
      <p v-if="description" class="mt-1 text-sm text-muted">{{ description }}</p>
    </template>
    <slot />
  </UCard>
  <section v-else class="space-y-5">
    <header v-if="title || description">
      <h2 v-if="title" class="text-lg font-semibold text-highlighted">{{ title }}</h2>
      <p v-if="description" class="mt-1 text-sm text-muted">{{ description }}</p>
    </header>
    <slot />
  </section>
</template>
