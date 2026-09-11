<script setup lang="ts">
const props = defineProps<{ loading?: boolean; error?: unknown; empty?: boolean; emptyText?: string }>()
defineEmits<{ retry: [] }>()
const errorKey = computed(() => {
  const error = props.error as { status?: number; statusCode?: number } | null
  const status = error?.status ?? error?.statusCode
  return status === 403 ? 'errors.forbidden' : status === 404 ? 'errors.notFound' : status === 409 ? 'errors.conflict' : 'errors.generic'
})
</script>
<template>
  <div v-if="loading" role="status" class="space-y-3 py-8" :aria-label="$t('app.loading')"><USkeleton v-for="n in 3" :key="n" class="h-12" /></div>
  <UAlert v-else-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="$t(errorKey)"><template #actions><UButton color="neutral" variant="outline" @click="$emit('retry')">{{ $t('app.retry') }}</UButton></template></UAlert>
  <div v-else-if="empty" role="status" class="rounded-xl border border-dashed border-default px-6 py-10 text-center text-sm text-muted">{{ emptyText ?? $t('app.noResults') }}</div>
  <slot v-else />
</template>
