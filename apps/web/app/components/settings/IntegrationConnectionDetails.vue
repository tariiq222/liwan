<script setup lang="ts">
import type { IntegrationConnection, IntegrationProvider, IntegrationSecretRotation } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { badgeLabel } from '@liwan/ui/app/utils/statusBadge'
import {
  useDeleteIntegrationConnection,
  useRotateIntegrationSecret,
  useTestIntegrationConnection,
  useUpdateIntegrationConnection,
} from '@/composables/useIntegrationConnections'
import { useStartIntegrationOAuth } from '@/composables/useIntegrationProviders'
import { ApiError } from '@/composables/useApi'
import { typedValues } from '@/utils/integrationConnections'
import { integrationAttributeLabel, integrationErrorText, integrationProviderLabel, integrationSecretLabel, integrationServerMessage, integrationUseLabel } from '@/utils/integrationLabels'
import { integrationStateBadge } from '@/utils/integrationStateBadge'

// The body of a connection's page: its state with the actions on it (test, switch off or on, reconnect, disconnect),
// its identity, its secrets as presence with a replace input, the generated secrets with rotation (the new value shows
// once), and the addresses the provider calls. A secret value never arrives from the server, so no input is ever
// filled from it. Every answer replaces the cached connection, so the page always shows what the server holds.
const props = defineProps<{ connection: IntegrationConnection; provider?: IntegrationProvider; canManage: boolean }>()
const emit = defineEmits<{ disconnected: [] }>()
const { t, te } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const update = useUpdateIntegrationConnection()
const test = useTestIntegrationConnection()
const rotate = useRotateIntegrationSecret()
const remove = useDeleteIntegrationConnection()
const start = useStartIntegrationOAuth()
const clipboard = useClipboard({ copiedDuring: 2000 })
const idBase = useId()

const working = computed(() => update.isPending.value || test.isPending.value || rotate.isPending.value || remove.isPending.value || start.isPending.value)
const locked = computed(() => !hydrated.value || !props.canManage || working.value)
const failure = ref('')
const inUseMessage = ref('')
const confirmingDisconnect = ref(false)
const rotated = ref<IntegrationSecretRotation | null>(null)

const badge = computed(() => integrationStateBadge(props.connection.state))
const id = computed(() => props.connection.id as number)
const typedNames = computed(() => (props.connection.auth === 'keys' ? props.provider?.secrets ?? [] : []))
const generated = computed(() => props.provider?.generated_secrets ?? [])
const present = (name: string) => props.connection.secrets.some(secret => secret.name === name && secret.present)

const identity = reactive({ label: props.connection.label, app_id: props.connection.app_id ?? '' })
const identityChanged = computed(() => identity.label.trim() !== props.connection.label || (identity.app_id.trim() !== '' && identity.app_id.trim() !== (props.connection.app_id ?? '')))
const typed = reactive<Record<string, string>>({})
const secretsChanged = computed(() => Object.keys(typedValues(typed)).length > 0)
onBeforeUnmount(() => {
  for (const name of Object.keys(typed)) typed[name] = ''
  rotated.value = null
})

function reset() {
  failure.value = ''
  inUseMessage.value = ''
}

async function run(task: () => Promise<void>) {
  if (locked.value) return
  reset()
  try { await task() } catch (error) {
    if (error instanceof ApiError && error.code === 'in_use') inUseMessage.value = integrationServerMessage(error)
    failure.value = integrationErrorText(error, t)
  }
}

const testConnection = () => run(async () => {
  await test.mutateAsync(id.value)
  toast.add({ title: t('integrations.record.tested'), color: 'success' })
})
const setState = (state: 'disabled' | 'pending') => run(async () => {
  await update.mutateAsync({ id: id.value, body: { state } })
  toast.add({ title: t('integrations.record.stateChanged'), color: 'success' })
})
const saveIdentity = () => run(async () => {
  const appId = identity.app_id.trim()
  const saved = await update.mutateAsync({
    id: id.value,
    body: { label: identity.label.trim(), ...(appId && appId !== (props.connection.app_id ?? '') ? { app_id: appId } : {}) },
  })
  identity.label = saved.label
  identity.app_id = saved.app_id ?? ''
  toast.add({ title: t('integrations.record.identitySaved'), color: 'success' })
})
const replaceSecrets = () => run(async () => {
  await update.mutateAsync({ id: id.value, body: { secrets: typedValues(typed) } })
  for (const name of Object.keys(typed)) typed[name] = ''
  toast.add({ title: t('integrations.record.secretsSaved'), color: 'success' })
})
const rotateSecret = (name: string) => run(async () => {
  rotated.value = await rotate.mutateAsync({ id: id.value, name })
})
const disconnect = () => run(async () => {
  try {
    await remove.mutateAsync(id.value)
  } finally {
    confirmingDisconnect.value = false
  }
  emit('disconnected')
})
const reconnect = () => run(async () => {
  const uses = props.connection.used_by.length ? props.connection.used_by : (props.provider?.uses ?? []).map(use => use.key)
  const { authorize_url } = await start.mutateAsync({ provider: props.connection.provider, body: { uses, connection_id: id.value } })
  window.location.assign(authorize_url)
})
async function copy(value: string) {
  await clipboard.copy(value)
  toast.add({ title: t('integrations.record.copied'), color: 'success' })
}
</script>

<template>
  <div class="grid gap-(--liwan-gap-card)" data-testid="integration-record">
    <SharedRecordSection id="status" variant="panel" :title="t('integrations.record.status')">
      <div class="grid gap-3 text-start">
        <div class="flex flex-wrap items-center gap-3">
          <SharedStatusBadge :tone="badge.tone" :label="badgeLabel(badge, connection.state, t)" data-testid="integration-state" />
          <p class="text-sm text-muted">{{ connection.last_checked ? t('integrations.connections.lastChecked', { at: formatDateTime(connection.last_checked) }) : t('integrations.connections.neverChecked') }}</p>
        </div>
        <p v-if="connection.status_message" class="text-sm text-default" data-testid="integration-status-message">{{ connection.status_message }}</p>
        <div v-if="canManage" class="flex flex-wrap gap-2">
          <UButton color="neutral" variant="outline" icon="i-lucide-activity" :loading="test.isPending.value" :disabled="locked" :label="t('integrations.record.test')" data-testid="integration-test" @click="testConnection" />
          <UButton v-if="connection.state === 'disabled'" color="neutral" variant="outline" icon="i-lucide-circle-play" :disabled="locked" :label="t('integrations.record.enable')" data-testid="integration-enable" @click="setState('pending')" />
          <UButton v-else color="neutral" variant="outline" icon="i-lucide-circle-pause" :disabled="locked" :label="t('integrations.record.disable')" data-testid="integration-disable" @click="setState('disabled')" />
          <UButton v-if="connection.auth === 'oauth'" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="start.isPending.value" :disabled="locked" :label="t('integrations.record.reconnect')" data-testid="integration-reconnect" @click="reconnect" />
          <UButton color="error" variant="outline" icon="i-lucide-unplug" :disabled="locked || confirmingDisconnect" :label="t('integrations.record.disconnect')" data-testid="integration-disconnect" @click="confirmingDisconnect = true" />
        </div>
        <SharedInlineConfirm
          v-if="confirmingDisconnect"
          :title="t('integrations.record.confirmDisconnectTitle')"
          :description="t('integrations.record.confirmDisconnectDescription')"
          :confirm-label="t('integrations.record.confirmDisconnect')"
          :pending="remove.isPending.value"
          @confirm="disconnect"
          @cancel="confirmingDisconnect = false"
        />
        <UAlert v-if="inUseMessage" role="alert" color="error" variant="subtle" :title="t('integrations.errors.inUse')" :description="inUseMessage" data-testid="integration-in-use" />
        <UAlert v-else-if="failure" role="alert" color="error" variant="subtle" :title="failure" data-testid="integration-error" />
      </div>
    </SharedRecordSection>

    <SharedRecordSection id="identity" variant="panel" :title="t('integrations.record.identity')" :description="canManage ? t('integrations.record.identityHint') : undefined">
      <div class="grid gap-4 text-start">
        <SharedSettingRow :label="t('integrations.record.provider')"><span class="text-sm text-highlighted">{{ integrationProviderLabel(connection.provider, t, te) }}</span></SharedSettingRow>
        <SharedSettingRow :label="t('integrations.record.accountId')"><span class="text-sm text-highlighted" dir="ltr">{{ connection.external_id }}</span></SharedSettingRow>
        <SharedSettingRow v-if="connection.token_expires_at" :label="t('integrations.record.tokenExpires')"><span class="text-sm text-highlighted">{{ formatDateTime(connection.token_expires_at) }}</span></SharedSettingRow>
        <UFormField :label="t('integrations.field.label')" name="label">
          <UInput :id="`${idBase}-label`" v-model="identity.label" class="w-full" :disabled="locked" data-testid="integration-label" />
        </UFormField>
        <UFormField v-if="provider?.attributes.includes('app_id')" :label="integrationAttributeLabel('app_id', t, te)" name="app_id">
          <UInput :id="`${idBase}-app_id`" v-model="identity.app_id" dir="ltr" class="w-full" :disabled="locked" data-testid="integration-app-id" />
        </UFormField>
        <div v-if="canManage" class="flex justify-end">
          <UButton color="primary" :disabled="locked || !identityChanged" :loading="update.isPending.value" :label="t('integrations.record.saveIdentity')" data-testid="integration-save-identity" @click="saveIdentity" />
        </div>
      </div>
    </SharedRecordSection>

    <SharedRecordSection v-if="typedNames.length || generated.length" id="secrets" variant="panel" :title="t('integrations.record.secrets')" :description="t('integrations.record.secretsHint')">
      <div class="grid gap-4 text-start">
        <UFormField v-for="name in typedNames" :key="name" :name="name" :label="integrationSecretLabel(name, t, te)">
          <template #hint>
            <SharedStatusBadge size="sm" :tone="present(name) ? 'success' : 'neutral'" :label="t(present(name) ? 'integrations.record.secretPresent' : 'integrations.record.secretAbsent')" :data-testid="`integration-present-${name}`" />
          </template>
          <UInput :id="`${idBase}-${name}`" v-model="typed[name]" type="password" autocomplete="new-password" dir="ltr" class="w-full" :placeholder="present(name) ? t('integrations.record.secretKeep') : undefined" :disabled="locked" :data-testid="`integration-secret-${name}`" />
        </UFormField>
        <div v-if="canManage && typedNames.length" class="flex justify-end">
          <UButton color="primary" :disabled="locked || !secretsChanged" :loading="update.isPending.value" :label="t('integrations.record.saveSecrets')" data-testid="integration-save-secrets" @click="replaceSecrets" />
        </div>
        <SharedSettingRow v-for="name in generated" :key="name" :label="integrationSecretLabel(name, t, te)">
          <div class="flex flex-wrap items-center gap-2">
            <SharedStatusBadge size="sm" :tone="present(name) ? 'success' : 'neutral'" :label="t(present(name) ? 'integrations.record.secretPresent' : 'integrations.record.secretAbsent')" :data-testid="`integration-present-${name}`" />
            <UButton v-if="canManage" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="rotate.isPending.value" :disabled="locked" :label="t('integrations.record.rotate')" :data-testid="`integration-rotate-${name}`" @click="rotateSecret(name)" />
          </div>
        </SharedSettingRow>
        <UAlert v-if="rotated" role="status" color="warning" variant="subtle" icon="i-lucide-key-round" :title="t('integrations.record.rotatedTitle', { name: integrationSecretLabel(rotated.name, t, te) })" :description="t('integrations.record.rotatedHint')" data-testid="integration-rotated">
          <template #actions>
            <div class="flex w-full min-w-0 flex-wrap items-center gap-2">
              <code class="min-w-0 flex-1 break-all rounded-md bg-elevated px-2 py-1 text-sm" dir="ltr" data-testid="integration-rotated-value">{{ rotated.value }}</code>
              <UButton color="neutral" variant="outline" icon="i-lucide-copy" :disabled="!hydrated" :label="t('integrations.record.copy')" data-testid="integration-rotated-copy" @click="copy(rotated.value)" />
            </div>
          </template>
        </UAlert>
      </div>
    </SharedRecordSection>

    <SharedRecordSection v-if="connection.webhooks.length" id="webhooks" variant="list" :title="t('integrations.record.webhooks')" :description="t('integrations.record.webhooksHint')">
      <ul class="divide-y divide-default" data-testid="integration-webhooks">
        <li v-for="webhook in connection.webhooks" :key="webhook.use" class="flex min-w-0 flex-wrap items-center justify-between gap-3 px-(--liwan-card-pad-dense) py-3 text-start">
          <div class="min-w-0">
            <p class="text-sm font-medium text-highlighted">{{ integrationUseLabel(webhook.use, t, te) }}</p>
            <p class="break-all text-sm text-muted" dir="ltr">{{ webhook.url }}</p>
          </div>
          <UButton color="neutral" variant="outline" icon="i-lucide-copy" :disabled="!hydrated" :label="t('integrations.record.copy')" :data-testid="`integration-webhook-copy-${webhook.use}`" @click="copy(webhook.url)" />
        </li>
      </ul>
    </SharedRecordSection>
  </div>
</template>
