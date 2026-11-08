<script setup lang="ts">
// The loading, empty and error state of a slide-over list: one centred line, and for an error a retry button.
const props = defineProps<{ kind: 'loading' | 'empty' | 'error'; message: string; retryLabel?: string }>()
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="liwan-panel-empty" :role="props.kind === 'error' ? 'alert' : 'status'" :data-kind="props.kind">
    <p>{{ props.message }}</p>
    <UButton v-if="props.kind === 'error' && props.retryLabel" color="neutral" variant="outline" size="sm" class="mt-2" :label="props.retryLabel" @click="emit('retry')" />
  </div>
</template>
