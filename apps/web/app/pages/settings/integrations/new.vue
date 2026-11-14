<script setup lang="ts">
import type { IntegrationConnection } from '@liwan/contracts'
import IntegrationConnectionForm from '@/components/settings/IntegrationConnectionForm.vue'
import { useIntegrationProviders } from '@/composables/useIntegrationProviders'
import { integrationProviderLabel } from '@/utils/integrationLabels'

// The create panel over the integrations page: connect an account of a provider that takes keys. `?provider=<code>`
// names the provider; a code the server does not offer for keys shows why instead of a form.
const BACK_TO = '/settings/integrations'
const route = useRoute()
const { t, te } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('integrations.manage'))
const providers = useIntegrationProviders(() => !forbidden.value)
const code = computed(() => (typeof route.query.provider === 'string' ? route.query.provider : ''))
const provider = computed(() => providers.data.value?.items.find(item => item.code === code.value && item.auth === 'keys'))
const title = computed(() => (provider.value ? t('integrations.new.title', { provider: integrationProviderLabel(provider.value.code, t, te) }) : t('integrations.providers.title')))

function openRecord(connection: IntegrationConnection) {
  return navigateTo(`/settings/integrations/connections/${connection.id}`, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="title" :back-to="BACK_TO">
    <SharedForbiddenState v-if="forbidden" :description="t('integrations.errors.forbidden')" />
    <SharedPageState v-else :loading="providers.isLoading.value" :error="providers.error.value" :empty="!provider" :empty-text="t('integrations.new.unknownProvider')" @retry="providers.refetch()">
      <IntegrationConnectionForm v-if="provider" :provider="provider" :back-to="BACK_TO" @created="openRecord" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
