<script setup lang="ts">
import { errorStateKind } from '@/utils/errorState'

// A failed load (Tasmim spec §6): what went wrong and one way forward.
// `error` only picks the title; SharedPageState routes 403/404 to their own states first.
const props = defineProps<{ error?: unknown; title?: string }>()
defineEmits<{ retry: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const heading = computed(() => props.title ?? t(errorStateKind(props.error) === 'conflict' ? 'errors.conflict' : 'errors.generic'))
</script>

<template>
  <UAlert role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="heading" :ui="{ title: 'text-highlighted' }" data-slot="error-state">
    <template #actions>
      <UButton color="neutral" variant="outline" :disabled="!hydrated" @click="$emit('retry')">{{ t('app.retry') }}</UButton>
    </template>
  </UAlert>
</template>
