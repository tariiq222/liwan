<script setup lang="ts">
// The loading, empty and error state of a slide-over list. Empty and error are one centred line (an error adds a retry
// button); loading is a few placeholder rows shaped like ShellPanelRow, so the list does not jump when it arrives. The
// message stays as the status text for assistive technology.
const props = defineProps<{ kind: 'loading' | 'empty' | 'error'; message: string; retryLabel?: string }>()
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div v-if="props.kind === 'loading'" class="liwan-panel-loading" role="status" aria-busy="true" data-kind="loading">
    <span class="sr-only">{{ props.message }}</span>
    <div v-for="n in 4" :key="n" class="liwan-panel-loading-row" aria-hidden="true">
      <USkeleton class="size-8 shrink-0 rounded-full" />
      <div class="grid min-w-0 flex-1 gap-1.5">
        <USkeleton class="h-3.5 w-3/4" />
        <USkeleton class="h-3 w-1/2" />
      </div>
    </div>
  </div>
  <div v-else class="liwan-panel-empty" :role="props.kind === 'error' ? 'alert' : 'status'" :data-kind="props.kind">
    <p>{{ props.message }}</p>
    <UButton v-if="props.kind === 'error' && props.retryLabel" color="neutral" variant="outline" size="sm" class="mt-2" :label="props.retryLabel" @click="emit('retry')" />
  </div>
</template>
