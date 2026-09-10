<script setup lang="ts">
defineProps<{ state: string }>()
defineEmits<{ retry: []; clear: [] }>()
const { t } = usePreview()
</script>
<template>
  <div v-if="state === 'loading'" role="status" class="space-y-4 py-6">
    <span class="sr-only">{{ t('loading') }}</span>
    <USkeleton v-for="index in 5" :key="index" class="h-12 w-full" />
  </div>
  <UAlert v-else-if="state === 'error'" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('errorTitle')" :description="t('errorHint')" :actions="[{ label: t('retry'), color: 'error', variant: 'outline', onClick: () => $emit('retry') }]" />
  <div v-else class="flex flex-col items-center text-center gap-3 py-14 px-4" role="status">
    <div class="rounded-xl bg-elevated p-4"><UIcon name="i-lucide-search-x" class="size-7 text-muted" /></div>
    <h2 class="preview-section-title">{{ t('emptyTitle') }}</h2>
    <p class="text-muted max-w-md leading-relaxed">{{ t('emptyHint') }}</p>
    <UButton type="button" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="t('clear')" :title="t('clear')" @click="$emit('clear')" />
  </div>
</template>
