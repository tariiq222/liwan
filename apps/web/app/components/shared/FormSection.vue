<script setup lang="ts">
defineProps<{
  title?: string
  description?: string
  panel?: boolean
}>()
</script>

<template>
  <section :class="panel ? 'nasq-panel overflow-hidden' : 'nasq-form-section'">
    <header v-if="title || description" :class="panel ? 'nasq-panel-header' : 'nasq-form-section-heading'">
      <div>
      <h2 v-if="title" class="nasq-form-section-title">{{ title }}</h2>
      <p v-if="description" class="nasq-form-section-hint">{{ description }}</p>
      </div>
    </header>
    <div v-if="panel" class="nasq-panel-body"><slot /></div>
    <slot v-else />
  </section>
</template>
