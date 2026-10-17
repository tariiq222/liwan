<script setup lang="ts">
import { useProjectList } from '@/composables/useProjects'

// Charters submitted to the signed-in sponsor, waiting for their decision: the dashboard's one call to action
// (a SharedRecordSection `action`). Nothing renders while loading or when no charter is waiting.
const { t } = useI18n()
const { data, error, refetch } = useProjectList(ref(false), { charterReview: true, limit: 20 })
const items = computed(() => data.value?.items ?? [])
</script>

<template>
  <SharedErrorState v-if="error" data-testid="pending-charters-error" :error="error" @retry="refetch()" />
  <SharedRecordSection v-else-if="items.length" variant="action" data-testid="pending-charters" :title="t('projects.dashboard.pendingCharters')" :description="t('projects.dashboard.pendingChartersHint')">
    <template #actions>
      <UBadge color="primary" variant="subtle" size="lg" class="tabular-nums" data-testid="pending-charters-count">{{ items.length }}</UBadge>
    </template>
    <ul class="divide-y divide-default">
      <li v-for="item in items" :key="item.id" class="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
        <span class="min-w-0 truncate font-medium text-highlighted">{{ item.name }}</span>
        <UButton :to="`/projects/${item.id}/charter`" size="sm" color="primary" :label="t('projects.dashboard.reviewCharter')" class="shrink-0" data-testid="pending-charter-link" />
      </li>
    </ul>
  </SharedRecordSection>
</template>
