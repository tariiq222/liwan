<script setup lang="ts">
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'
import { badgeLabel } from '@webvue/ui/app/utils/statusBadge'
import { useIntegrationConnections } from '@/composables/useIntegrationConnections'
import { integrationStateBadge } from '@/utils/integrationStateBadge'

const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('integrations.read'))
const { data, isLoading, error, refetch } = useIntegrationConnections(computed(() => !forbidden.value))
const items = computed(() => data.value?.items ?? [])
</script>

<template>
  <SharedListPage data-testid="settings-layout" :title="t('integrations.title')" :description="forbidden ? undefined : t('integrations.description')">
    <SharedForbiddenState v-if="forbidden" :description="t('integrations.forbidden')" />
    <SharedListCard v-else>
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
    </SharedListCard>
  </SharedListPage>
</template>
