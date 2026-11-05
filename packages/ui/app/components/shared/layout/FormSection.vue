<script setup lang="ts">
// A titled group of form fields: the shared panel card with `panel`, otherwise a flat section whose fields
// tile on the shared auto grid (one column on a phone, more as the workspace grows).
import RecordSection from './RecordSection.vue'

defineProps<{
  title?: string
  description?: string
  panel?: boolean
}>()
</script>

<template>
  <RecordSection :variant="panel ? 'panel' : 'flat'" :title="title" :description="description">
    <slot v-if="panel" />
    <div v-else class="liwan-auto-grid liwan-field-grid"><slot /></div>
  </RecordSection>
</template>
