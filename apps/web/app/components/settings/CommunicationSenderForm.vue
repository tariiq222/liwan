<script setup lang="ts">
import type { IntegrationSender, IntegrationSenderChannel, IntegrationSenderCreate, IntegrationSenderKind } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useIntegrationConnections } from '@/composables/useIntegrationConnections'
import { useIntegrationProviders } from '@/composables/useIntegrationProviders'
import { useAvailableNumbers, useCreateIntegrationSender } from '@/composables/useIntegrationCommunications'
import { integrationErrorText, integrationProviderLabel, integrationServerMessage } from '@/utils/integrationLabels'
import { providerHasSenders } from '@/utils/integrationMessaging'
import { providerHasVoice } from '@/utils/integrationVoice'

// The form of the sender create panel: the messaging account, the channel, what kind of sender it is and its value. A
// phone number for SMS is picked from the numbers the provider account really holds (read live from the provider, so
// a provider refusal shows here with a retry); a WhatsApp number, a sender name, a messaging service and a voice
// number are typed or picked. The voice channel is offered only when the account's provider declares its voice use.
// The server checks the kind the channel accepts and that a number belongs to the account, and a refusal leaves the
// typed values in place.
const props = defineProps<{ backTo: string }>()
const emit = defineEmits<{ created: [sender: IntegrationSender] }>()
const { t, te } = useI18n()
const hydrated = useHydrated()
const create = useCreateIntegrationSender()
const idBase = useId()

const connections = useIntegrationConnections()
const providers = useIntegrationProviders()
const accounts = computed(() => {
  const codes = new Set((providers.data.value?.items ?? []).filter(providerHasSenders).map(provider => provider.code))
  return (connections.data.value?.items ?? []).filter(connection => connection.id !== null && connection.state === 'connected' && codes.has(connection.provider))
})
const accountItems = computed(() => accounts.value.map(account => ({ label: account.label || integrationProviderLabel(account.provider, t, te), value: account.id as number })))
// The voice channel exists only when a provider of a connected account declares its voice use.
const hasVoice = computed(() => (providers.data.value?.items ?? []).some(providerHasVoice))

// The channels this delivery offers, and the kinds each accepts (the server's own table).
type Channel = 'sms' | 'whatsapp' | 'voice'
const KINDS: Record<Channel, IntegrationSenderKind[]> = { sms: ['number', 'alphanumeric', 'service'], whatsapp: ['number', 'service'], voice: ['number'] }
const connectionId = ref<number | undefined>(undefined)
const channel = ref<Channel>('sms')
const kind = ref<IntegrationSenderKind>('number')
const value = ref('')
const isDefault = ref(false)
const fieldErrors = ref<Record<string, string>>({})
const failure = ref('')
const saved = ref(false)
watch(accounts, list => { if (connectionId.value === undefined && list.length === 1) connectionId.value = list[0]!.id as number }, { immediate: true })
watch(channel, () => { if (!KINDS[channel.value].includes(kind.value)) kind.value = 'number'; value.value = '' })
watch([kind, connectionId], () => { value.value = '' })

const picksNumber = computed(() => (channel.value === 'sms' || channel.value === 'voice') && kind.value === 'number')
const available = useAvailableNumbers(() => connectionId.value ?? null, picksNumber)
const numberItems = computed(() => (available.data.value?.items ?? [])
  .filter(number => (channel.value === 'voice' ? number.voice : number.sms))
  .map(number => ({ label: number.label && number.label !== number.value ? `${number.value} · ${number.label}` : number.value, value: number.value })))
const providerError = computed(() => (available.error.value ? (available.error.value instanceof ApiError && integrationServerMessage(available.error.value)) || t('integrations.communications.senderForm.providerError') : ''))

const channelItems = computed(() => (hasVoice.value ? (['sms', 'whatsapp', 'voice'] as const) : (['sms', 'whatsapp'] as const)).map(item => ({ label: t(`integrations.communications.channel.${item}`), value: item })))
const kindItems = computed(() => KINDS[channel.value].map(item => ({ label: t(`integrations.communications.kind.${item}`), value: item })))
const dirty = computed(() => !saved.value && Boolean(value.value.trim() || isDefault.value))
const busy = computed(() => !hydrated.value || create.isPending.value)

const E164 = /^\+[1-9]\d{6,14}$/
const SERVICE = /^MG[0-9a-fA-F]{32}$/
function invalidValue(text: string): string | null {
  if (!text) return t('integrations.communications.senderForm.required')
  if (kind.value === 'alphanumeric' && (text.length > 11 || !/^[A-Za-z0-9 ]+$/.test(text))) return t('integrations.communications.senderForm.alphanumericInvalid')
  if (kind.value === 'number' && !E164.test(text)) return t('integrations.communications.senderForm.numberInvalid')
  if (kind.value === 'service' && !SERVICE.test(text)) return t('integrations.communications.senderForm.serviceInvalid')
  return null
}
const focusField = async (name: string) => { await nextTick(); document.getElementById(`${idBase}-${name}`)?.focus() }

async function submit() {
  if (busy.value) return
  failure.value = ''
  fieldErrors.value = {}
  if (connectionId.value === undefined) {
    fieldErrors.value = { connection_id: t('integrations.communications.senderForm.required') }
    return focusField('connection_id')
  }
  const text = value.value.trim()
  const problem = invalidValue(text)
  if (problem) {
    fieldErrors.value = { value: problem }
    return focusField('value')
  }
  const body: IntegrationSenderCreate = { connection_id: connectionId.value, channel: channel.value as IntegrationSenderChannel, kind: kind.value, value: text, ...(isDefault.value ? { is_default: true } : {}) }
  try {
    const sender = await create.mutateAsync(body)
    saved.value = true
    emit('created', sender)
  } catch (error) {
    const field = error instanceof ApiError ? error.field : undefined
    const text = integrationServerMessage(error) || integrationErrorText(error, t)
    if (field && ['connection_id', 'channel', 'kind', 'value'].includes(field)) fieldErrors.value = { [field]: text }
    else failure.value = text
  }
}
</script>

<template>
  <UForm :state="{ connectionId, channel, kind, value }" class="liwan-form" method="post" :loading-auto="false" novalidate data-testid="communication-sender-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('integrations.communications.senderForm.details')">
      <div class="grid gap-4">
        <UFormField :label="t('integrations.communications.senderForm.account')" name="connection_id" required :error="fieldErrors.connection_id">
          <USelect :id="`${idBase}-connection_id`" v-model="connectionId" :items="accountItems" class="w-full" :placeholder="t('integrations.communications.senderForm.accountPlaceholder')" :disabled="busy" data-testid="communication-sender-account" />
        </UFormField>
        <UFormField :label="t('integrations.communications.senderForm.channel')" name="channel" required :error="fieldErrors.channel">
          <USelect :id="`${idBase}-channel`" v-model="channel" :items="channelItems" class="w-full" :disabled="busy" data-testid="communication-sender-channel" />
        </UFormField>
        <UFormField :label="t('integrations.communications.senderForm.kind')" :description="t(`integrations.communications.senderForm.kindHint.${kind}`)" name="kind" required :error="fieldErrors.kind">
          <USelect :id="`${idBase}-kind`" v-model="kind" :items="kindItems" class="w-full" :disabled="busy" data-testid="communication-sender-kind" />
        </UFormField>
        <UFormField :label="t(`integrations.communications.senderForm.value.${kind}`)" name="value" required :error="fieldErrors.value">
          <template v-if="picksNumber">
            <USelect v-if="numberItems.length" :id="`${idBase}-value`" v-model="value" :items="numberItems" dir="ltr" class="w-full" :placeholder="t('integrations.communications.senderForm.numberPlaceholder')" :disabled="busy" data-testid="communication-sender-number" />
            <p v-else-if="connectionId === undefined" class="text-sm text-muted">{{ t('integrations.communications.senderForm.pickAccount') }}</p>
            <p v-else-if="available.isLoading.value" class="text-sm text-muted" role="status">{{ t('integrations.communications.senderForm.loadingNumbers') }}</p>
            <UAlert v-else-if="providerError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('integrations.communications.senderForm.providerErrorTitle')" :description="providerError" :actions="[{ label: t('integrations.communications.retry'), color: 'neutral', variant: 'outline', onClick: () => available.refetch() }]" data-testid="communication-sender-provider-error" />
            <p v-else class="text-sm text-muted" data-testid="communication-sender-no-numbers">{{ t('integrations.communications.senderForm.noNumbers') }}</p>
          </template>
          <UInput v-else :id="`${idBase}-value`" v-model="value" dir="ltr" class="w-full" :disabled="busy" :maxlength="kind === 'alphanumeric' ? 11 : 64" data-testid="communication-sender-value" />
        </UFormField>
        <USwitch v-model="isDefault" :label="t('integrations.communications.senderForm.default')" :description="t('integrations.communications.senderForm.defaultHint')" :disabled="busy" data-testid="communication-sender-default" />
      </div>
    </SharedFormSection>
    <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="failure" data-testid="communication-sender-form-error" />
    <SharedFormActions>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton :to="props.backTo" color="neutral" variant="outline" :disabled="create.isPending.value" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="busy" :loading="create.isPending.value" :label="t('integrations.communications.senderForm.submit')" data-testid="communication-sender-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
