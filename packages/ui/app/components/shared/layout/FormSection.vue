<script setup lang="ts">
// A titled group of form fields: the shared panel card with `panel`, otherwise a flat section whose fields sit 20px apart.
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
    <div v-else class="space-y-5"><slot /></div>
  </RecordSection>
</template>
