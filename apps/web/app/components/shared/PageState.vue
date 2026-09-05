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
  <div v-if="loading" role="status" class="space-y-3 py-8" :aria-label="$t('app.loading')"><div v-for="n in 3" :key="n" class="h-12 animate-pulse rounded-md bg-muted" /></div>
  <div v-else-if="error" role="alert" class="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm"><p>{{ $t(errorKey) }}</p><Button variant="outline" class="mt-3" @click="$emit('retry')">{{ $t('app.retry') }}</Button></div>
  <div v-else-if="empty" role="status" class="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">{{ emptyText ?? $t('app.noResults') }}</div>
  <slot v-else />
</template>
