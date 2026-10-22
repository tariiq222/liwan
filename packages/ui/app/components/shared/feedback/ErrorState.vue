<script setup lang="ts">
import { errorStateKind } from '../../../utils/errorState'

// A failed load (Tasmim spec §6): what went wrong and one way forward, small and centred where the content would have been.
// `error` only picks the title; SharedPageState routes 403/404 to their own states first.
const props = defineProps<{ error?: unknown; title?: string }>()
defineEmits<{ retry: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const heading = computed(() => props.title ?? t(errorStateKind(props.error) === 'conflict' ? 'errors.conflict' : 'errors.generic'))
</script>

<template>
  <div role="alert" class="flex flex-col items-center justify-center gap-3 px-6 py-8 text-center" data-slot="error-state">
    <span class="flex size-9 items-center justify-center rounded-full bg-error/10 text-error" aria-hidden="true">
      <UIcon name="i-lucide-circle-alert" class="size-5" />
    </span>
    <p class="max-w-prose text-sm font-medium text-highlighted">{{ heading }}</p>
    <UButton size="xs" color="neutral" variant="outline" class="rounded-full" :disabled="!hydrated" @click="$emit('retry')">{{ t('app.retry') }}</UButton>
  </div>
</template>
