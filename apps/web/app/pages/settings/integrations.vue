<script setup lang="ts">
import IntegrationConnectionsCard from '@/components/settings/IntegrationConnectionsCard.vue'
import IntegrationProvidersCard from '@/components/settings/IntegrationProvidersCard.vue'
import { oauthReasonKey } from '@/utils/integrationLabels'

// The integrations settings page: every connected outside account, and the providers the customer can connect. A
// connection's own page and the create panel are its children; the create panel opens over the cards below.
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { parts, shows } = useSettingsPage('integrations')
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isRecordPage = computed(() => /^\/settings\/integrations\/connections(?:\/|$)/.test(normalizedPath.value))

// The provider's OAuth callback returns here with `result=connected` or `error=<reason>`. The page reads it once,
// shows it, and clears it from the address so a refresh does not repeat the notice.
const notice = ref<{ kind: 'connected' } | { kind: 'error'; reason: string } | null>(readNotice())
function readNotice() {
  const { result, error } = route.query
  if (typeof error === 'string' && error) return { kind: 'error' as const, reason: error }
  return result === 'connected' ? { kind: 'connected' as const } : null
}
onMounted(() => {
  if (!notice.value) return
  const { result: _result, error: _error, provider: _provider, ...rest } = route.query
  void router.replace({ path: route.path, query: rest, hash: route.hash })
})
</script>

<template>
  <NuxtPage v-if="isRecordPage" />
  <template v-else>
    <SharedSettingsPage>
      <SharedPageHeader :title="t('integrations.title')" />
      <SharedForbiddenState v-if="!parts.length" :description="t('settings.forbidden')" />
      <template v-else>
        <UAlert v-if="notice?.kind === 'connected'" role="status" color="success" variant="subtle" icon="i-lucide-circle-check" :title="t('integrations.oauth.connected')" data-testid="integration-oauth-connected" />
        <UAlert v-else-if="notice?.kind === 'error'" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('integrations.oauth.failedTitle')" :description="t(oauthReasonKey(notice.reason))" data-testid="integration-oauth-failed" />
        <IntegrationConnectionsCard v-if="shows('connections')" />
        <IntegrationProvidersCard v-if="shows('providers')" />
      </template>
    </SharedSettingsPage>
    <NuxtPage />
  </template>
</template>
