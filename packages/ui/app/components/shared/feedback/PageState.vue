<script setup lang="ts">
import { errorStateKind } from '../../../utils/errorState'
import EmptyState from './EmptyState.vue'
import ErrorState from './ErrorState.vue'
import ForbiddenState from './ForbiddenState.vue'
import LoadingSkeleton from './LoadingSkeleton.vue'
import NotFoundState from './NotFoundState.vue'

// A thin facade over the shared states (Tasmim spec §6). The props and the retry
// event its call sites use do not change; each branch is one shared state.
const props = defineProps<{ loading?: boolean; error?: unknown; empty?: boolean; emptyText?: string }>()
defineEmits<{ retry: [] }>()
const { t } = useI18n()
const kind = computed(() => errorStateKind(props.error))
</script>

<template>
  <LoadingSkeleton v-if="loading" />
  <ForbiddenState v-else-if="error && kind === 'forbidden'" />
  <NotFoundState v-else-if="error && kind === 'notFound'" />
  <ErrorState v-else-if="error" :error="error" @retry="$emit('retry')" />
  <EmptyState v-else-if="empty" :title="emptyText ?? t('app.noResults')" />
  <slot v-else />
</template>
