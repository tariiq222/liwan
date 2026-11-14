<script setup lang="ts">
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { badgeLabel } from '@liwan/ui/app/utils/statusBadge'
import { useIntegrationConnections } from '@/composables/useIntegrationConnections'
import { integrationProviderLabel, integrationUsedBy } from '@/utils/integrationLabels'
import { integrationStateBadge } from '@/utils/integrationStateBadge'

// The connections card of /settings/integrations: every connected account of the company with its state and the
// applications using it. A stored account opens its own page; an account an application manages links to that
// application's settings.
const { t, te } = useI18n()
const { data, isLoading, error, refetch } = useIntegrationConnections()
const items = computed(() => data.value?.items ?? [])
</script>

<template>
  <SharedRecordSection id="connections" variant="list" class="liwan-settings-anchor" :title="t('integrations.connections.title')" :description="t('integrations.connections.hint')">
    <SharedPageState :loading="isLoading" :error="error" :empty="items.length === 0" :empty-text="t('integrations.connections.empty')" :empty-description="t('integrations.connections.emptyHint')" @retry="refetch()">
      <ul class="divide-y divide-default" data-testid="integration-connections">
        <li v-for="item in items" :key="item.ref" class="flex min-w-0 flex-col gap-3 px-(--liwan-card-pad-dense) py-3 text-start sm:flex-row sm:items-center sm:justify-between" :data-testid="`integration-${item.ref}`">
          <div class="min-w-0">
            <p class="font-medium text-highlighted">
              <NuxtLink v-if="item.id !== null" :to="`/settings/integrations/connections/${item.id}`" class="hover:underline" :data-testid="`integration-open-${item.id}`">{{ integrationProviderLabel(item.provider, t, te) }}</NuxtLink>
              <template v-else>{{ integrationProviderLabel(item.provider, t, te) }}</template>
            </p>
            <p v-if="item.label || item.external_id" class="text-sm text-muted"><bdi>{{ item.label || item.external_id }}</bdi></p>
            <p v-if="item.id !== null || item.used_by.length" class="text-sm text-muted">{{ integrationUsedBy(item.used_by, t, te) }}</p>
            <p v-if="item.status_message" class="mt-1 text-sm text-default">{{ item.status_message }}</p>
          </div>
          <div class="flex flex-col items-start gap-1 sm:items-end">
            <SharedStatusBadge :tone="integrationStateBadge(item.state).tone" :label="badgeLabel(integrationStateBadge(item.state), item.state, t)" />
            <p class="text-xs text-muted">{{ item.last_checked ? t('integrations.connections.lastChecked', { at: formatDateTime(item.last_checked) }) : t('integrations.connections.neverChecked') }}</p>
            <UButton v-if="item.id === null && item.settings_path" :to="item.settings_path" color="neutral" variant="link" size="sm" :label="t('integrations.connections.manage')" :data-testid="`integration-manage-${item.provider}`" />
          </div>
        </li>
      </ul>
    </SharedPageState>
  </SharedRecordSection>
</template>
