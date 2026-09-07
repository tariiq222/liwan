<script setup lang="ts">
defineProps<{
  title?: string
  description?: string
}>()
</script>

<template>
  <section class="nasq-form-section">
    <h2 v-if="title" class="nasq-form-section-title">{{ title }}</h2>
    <p v-if="description" class="nasq-form-section-hint">{{ description }}</p>
    <slot />
  </section>
</template>
