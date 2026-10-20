<script setup lang="ts">
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'
import { badgeLabel } from '@webvue/ui/app/utils/statusBadge'
import { useIntegrationConnections } from '@/composables/useIntegrationConnections'
import { integrationStateBadge } from '@/utils/integrationStateBadge'

// The integrations card of the system settings page: every connection with its state, read-only.
const { t } = useI18n()
const { data, isLoading, error, refetch } = useIntegrationConnections()
const items = computed(() => data.value?.items ?? [])
</script>

<template>
  <SharedRecordSection variant="list" :title="t('integrations.title')">
    <SharedPageState :loading="isLoading" :error="error" :empty="items.length === 0" :empty-text="t('integrations.empty')" @retry="refetch()">
      <ul class="divide-y divide-default" data-testid="integration-connections">
        <li v-for="item in items" :key="item.id" class="flex min-w-0 flex-wrap items-center justify-between gap-3 px-(--webvue-card-pad-dense) py-3 text-start" :data-testid="`integration-${item.id}`">
          <div class="min-w-0">
            <p class="font-medium text-highlighted">{{ t(`integrations.kind.${item.kind}`) }}</p>
            <p class="text-sm text-muted">{{ item.provider }}</p>
            <p v-if="item.status_message" class="mt-1 text-sm text-default">{{ item.status_message }}</p>
          </div>
          <div class="flex flex-col items-end gap-1">
            <SharedStatusBadge :tone="integrationStateBadge(item.state).tone" :label="badgeLabel(integrationStateBadge(item.state), item.state, t)" />
            <p class="text-xs text-muted">{{ item.last_checked ? t('integrations.lastChecked', { at: formatDateTime(item.last_checked) }) : t('integrations.neverChecked') }}</p>
          </div>
        </li>
      </ul>
    </SharedPageState>
  </SharedRecordSection>
</template>
