<script setup lang="ts">
import { useIntegrationProviders, useStartIntegrationOAuth } from '@/composables/useIntegrationProviders'
import { integrationErrorText, integrationProviderLabel, integrationUseLabel } from '@/utils/integrationLabels'

// The providers card of /settings/integrations (integrations.manage): one row per provider the customer connects here.
// A `keys` provider opens the create panel; an `oauth` provider sends the browser to the provider's own page and the
// callback returns to this page. A provider an application manages itself is not listed: its status sits in the
// connections card with a link to that application.
const { t, te } = useI18n()
const hydrated = useHydrated()
const { data, isLoading, error, refetch } = useIntegrationProviders()
const start = useStartIntegrationOAuth()
const startFailure = ref('')
const connecting = ref('')
const items = computed(() => (data.value?.items ?? []).filter(provider => provider.auth !== 'external'))

// An oauth provider whose app credentials are missing on this system cannot start; `null` (other auth types) never blocks.
const oauthBlocked = (provider: { auth: string, oauth_ready: boolean | null }) => provider.auth === 'oauth' && provider.oauth_ready === false

async function connectOAuth(code: string, uses: string[]) {
  if (!hydrated.value || start.isPending.value) return
  startFailure.value = ''
  connecting.value = code
  try {
    const { authorize_url } = await start.mutateAsync({ provider: code, body: { uses } })
    window.location.assign(authorize_url)
  } catch (failure) {
    connecting.value = ''
    startFailure.value = integrationErrorText(failure, t)
  }
}
</script>

<template>
  <SharedRecordSection id="providers" variant="list" class="liwan-settings-anchor" :title="t('integrations.providers.title')" :description="t('integrations.providers.hint')">
    <SharedPageState empty-icon="i-lucide-plug" :loading="isLoading" :error="error" :empty="items.length === 0" :empty-text="t('integrations.providers.empty')" @retry="refetch()">
      <ul class="divide-y divide-default" data-testid="integration-providers">
        <li v-for="provider in items" :key="provider.code" class="flex min-w-0 flex-wrap items-center justify-between gap-3 px-(--liwan-card-pad-dense) py-3 text-start" :data-testid="`integration-provider-${provider.code}`">
          <div class="min-w-0">
            <p class="font-medium text-highlighted">{{ integrationProviderLabel(provider.code, t, te) }}</p>
            <p class="text-sm text-muted">{{ t(`integrations.auth.${provider.auth}`) }}</p>
            <p v-if="provider.uses.length" class="text-sm text-muted">{{ t('integrations.providers.usesFor', { uses: provider.uses.map(use => integrationUseLabel(use.key, t, te)).join(t('integrations.separator')) }) }}</p>
            <p v-if="oauthBlocked(provider)" class="mt-1 flex items-start gap-1.5 text-sm text-warning" :data-testid="`integration-oauth-not-ready-${provider.code}`">
              <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{{ t('integrations.oauth.notConfiguredHint') }}</span>
            </p>
          </div>
          <UButton
            v-if="provider.auth === 'oauth'"
            color="primary"
            variant="outline"
            icon="i-lucide-plug-zap"
            :loading="connecting === provider.code"
            :disabled="!hydrated || start.isPending.value || oauthBlocked(provider)"
            :label="t('integrations.providers.connect')"
            :aria-label="t('integrations.providers.connectLabel', { provider: integrationProviderLabel(provider.code, t, te) })"
            :data-testid="`integration-connect-${provider.code}`"
            @click="connectOAuth(provider.code, provider.uses.map(use => use.key))"
          />
          <UButton
            v-else
            :to="{ path: '/settings/integrations/new', query: { provider: provider.code } }"
            color="primary"
            variant="outline"
            icon="i-lucide-plug-zap"
            :label="t('integrations.providers.connect')"
            :aria-label="t('integrations.providers.connectLabel', { provider: integrationProviderLabel(provider.code, t, te) })"
            :data-testid="`integration-connect-${provider.code}`"
          />
        </li>
      </ul>
    </SharedPageState>
    <UAlert v-if="startFailure" class="m-(--liwan-card-pad-dense)" role="alert" color="error" variant="subtle" :title="t('integrations.oauth.startFailed')" :description="startFailure" data-testid="integration-oauth-error" />
  </SharedRecordSection>
</template>
