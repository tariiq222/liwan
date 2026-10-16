<script setup lang="ts">
import { useProjectList } from '@/composables/useProjects'

// Charters submitted to the signed-in sponsor, waiting for their decision.
// Nothing renders while loading or when no charter is waiting.
const { t } = useI18n()
const { data, error, refetch } = useProjectList(ref(false), { charterReview: true, limit: 20 })
const items = computed(() => data.value?.items ?? [])
</script>

<template>
  <SharedErrorState v-if="error" data-testid="pending-charters-error" :error="error" @retry="refetch()" />
  <UCard v-else-if="items.length" data-testid="pending-charters">
    <template #header>
      <h2 class="text-lg font-semibold text-highlighted">{{ t('projects.dashboard.pendingCharters') }}</h2>
    </template>
    <p class="mb-3 text-sm text-muted">{{ t('projects.dashboard.pendingChartersHint') }}</p>
    <ul class="divide-y divide-default">
      <li v-for="item in items" :key="item.id" class="py-2 first:pt-0 last:pb-0">
        <NuxtLink :to="`/projects/${item.id}/charter`" class="font-medium text-highlighted hover:underline" data-testid="pending-charter-link">{{ item.name }}</NuxtLink>
      </li>
    </ul>
  </UCard>
</template>
