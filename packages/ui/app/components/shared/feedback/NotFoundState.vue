<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

// The record is gone or hidden (404). The back link names where it leads, like SharedPageHeader's.
const props = defineProps<{ backTo?: RouteLocationRaw; backLabel?: string }>()
const { t } = useI18n()
</script>

<template>
  <div role="alert" data-slot="not-found-state" class="flex flex-col items-center gap-3 rounded-card border border-dashed border-default px-6 py-10 text-center">
    <UIcon name="i-lucide-search-x" class="size-6 text-muted" aria-hidden="true" />
    <p class="font-medium text-highlighted">{{ t('errors.notFound') }}</p>
    <p class="max-w-prose text-sm text-muted">{{ t('states.notFoundHint') }}</p>
    <UButton v-if="props.backTo" :to="props.backTo" color="neutral" variant="outline">
      <UIcon name="i-lucide-arrow-right" aria-hidden="true" class="size-4.5 ltr:rotate-180" />{{ props.backLabel ?? t('app.back') }}
    </UButton>
  </div>
</template>
