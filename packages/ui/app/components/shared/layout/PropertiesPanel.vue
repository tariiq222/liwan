<script setup lang="ts">
// The record's properties (Tasmim spec §6): one description list of SharedPropertyRow in the shared panel card.
import RecordSection from './RecordSection.vue'

const props = defineProps<{ title?: string }>()
</script>

<template>
  <RecordSection variant="panel" :title="props.title" data-slot="properties-panel">
    <dl class="divide-y divide-default"><slot /></dl>
  </RecordSection>
</template>
