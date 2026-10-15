<script setup lang="ts">
// The record's properties (Tasmim spec §6): one description list of SharedPropertyRow.
const props = defineProps<{ title?: string }>()
const headingId = useId()
</script>

<template>
  <section data-slot="properties-panel" class="rounded-lg bg-default px-4 py-3 ring ring-default" :aria-labelledby="props.title ? headingId : undefined">
    <h2 v-if="props.title" :id="headingId" class="text-sm font-semibold text-highlighted">{{ props.title }}</h2>
    <dl class="divide-y divide-default"><slot /></dl>
  </section>
</template>
