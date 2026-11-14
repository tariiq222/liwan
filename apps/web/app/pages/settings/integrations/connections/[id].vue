<script setup lang="ts">
import { statusTag, type PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { badgeLabel } from '@liwan/ui/app/utils/statusBadge'
import IntegrationConnectionDetails from '@/components/settings/IntegrationConnectionDetails.vue'
import { ApiError } from '@/composables/useApi'
import { useIntegrationConnection } from '@/composables/useIntegrationConnections'
import { useIntegrationProviders } from '@/composables/useIntegrationProviders'
import { integrationProviderLabel } from '@/utils/integrationLabels'
import { integrationStateBadge } from '@/utils/integrationStateBadge'

// One stored connection as a page of its own. Reading needs integrations.read; every action needs integrations.manage.
const BACK_TO = '/settings/integrations'
const route = useRoute()
const { t, te } = useI18n()
const { can } = useAccess()
const id = computed(() => {
  const value = Number(route.params.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const forbidden = computed(() => !can('integrations.read'))
const connection = useIntegrationConnection(id, () => !forbidden.value)
// The provider tells which secrets the customer types and which fields it asks for; the page works without it.
const providers = useIntegrationProviders(() => !forbidden.value)
const provider = computed(() => providers.data.value?.items.find(item => item.code === connection.data.value?.provider))
const pageError = computed(() => connection.error.value ?? (id.value === null && !forbidden.value ? new ApiError(404, 'not_found', t('integrations.record.notFound')) : null))
const title = computed(() => {
  const record = connection.data.value
  return record ? record.label || integrationProviderLabel(record.provider, t, te) : ''
})
const tags = computed<PageHeaderTag[]>(() => {
  const record = connection.data.value
  if (!record) return []
  const badge = integrationStateBadge(record.state)
  return [statusTag({ tone: badge.tone, label: badgeLabel(badge, record.state, t) }, 'integration-state-tag'), { label: integrationProviderLabel(record.provider, t, te), kind: 'category' }]
})
</script>

<template>
  <SharedRecordPage
    :keep-content="!!connection.data.value"
    :title="title"
    :tags="tags"
    :back-to="BACK_TO"
    :back-label="t('integrations.record.back')"
    :loading="connection.isLoading.value"
    :error="pageError"
    @retry="connection.refetch()"
  >
    <SharedForbiddenState v-if="forbidden" :description="t('integrations.errors.forbidden')" />
    <IntegrationConnectionDetails
      v-else-if="connection.data.value"
      :connection="connection.data.value"
      :provider="provider"
      :can-manage="can('integrations.manage')"
      @disconnected="navigateTo(BACK_TO, { replace: true })"
    />
  </SharedRecordPage>
</template>
