<script setup lang="ts">
defineProps<{
  title?: string
  description?: string
}>()
</script>

<template>
  <section class="nasq-form-section">
    <header v-if="title || description" class="nasq-form-section-heading">
      <h2 v-if="title" class="nasq-form-section-title">{{ title }}</h2>
      <p v-if="description" class="nasq-form-section-hint">{{ description }}</p>
    </header>
    <slot />
  </section>
</template>
