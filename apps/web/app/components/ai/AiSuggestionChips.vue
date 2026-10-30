<script setup lang="ts">
// Ready-made questions as pills (starters of an empty conversation, follow-ups above the composer); a click sends that text.
const props = defineProps<{
  items: readonly string[]
  label: string
  disabled?: boolean
}>()
const emit = defineEmits<{ pick: [text: string] }>()
</script>

<template>
  <ul v-if="props.items.length" :aria-label="props.label" class="flex flex-wrap gap-2">
    <li v-for="item in props.items" :key="item">
      <UButton type="button" color="neutral" variant="outline" size="sm" class="liwan-touch-target rounded-full" :disabled="props.disabled" :label="item" data-testid="ai-suggestion" @click="emit('pick', item)" />
    </li>
  </ul>
</template>
