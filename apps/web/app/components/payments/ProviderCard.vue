<script setup lang="ts">
import type { PaymentProvider, PaymentProviderState, PaymentProviderSyncStatus, PaymentProviderUpdate } from '@liwan/contracts'
import { badgeLabel } from '@liwan/ui/app/utils/statusBadge'
import {
  PAYMENT_PROVIDER_STATES,
  SYNC_OUTCOMES,
  countryName,
  credentialLabelKey,
  credentialsPatch,
  failedCredential,
  paymentProviderState,
  paymentStateBadge,
  providerErrorKey,
} from '@/composables/paymentProviders'
import { useSyncPaymentProvider, useUpdatePaymentProvider } from '@/composables/usePaymentProviders'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'

// One payment gateway the tenant connects with its own merchant account. Its keys and the country of the account are the
// card's form: one save sends both. Keys are write-only: nothing the server sends back fills an input, only whether each key
// is saved. While the gateway is on, a change of keys or country is checked against the gateway inside the same request,
// and a refusal saves nothing: the controls keep showing what is saved and the typed keys stay for another try.
// Switching the mode and testing the connection are actions on the gateway, not form values: they act at once.
const props = defineProps<{ provider: PaymentProvider; canEdit: boolean; reloadProvider: () => Promise<PaymentProvider> }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const update = useUpdatePaymentProvider()
const sync = useSyncPaymentProvider()

interface ProviderDraft { account_country: string | null; credentials: Record<string, string> }

const idBase = useId()
// What the last save refused on one key input.
const fieldErrors = ref<Record<string, string>>({})

/** The text of a refusal in the user's language: this page's own wording for a code it knows, else the API's text. */
function failureText(error: unknown): string {
  const key = providerErrorKey(error)
  return key ? t(key) : saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
}

/** The refusal of a save in the user's language. A refusal that names a key input is shown there, so the card says only that the save failed. */
function refusal(error: unknown): unknown {
  const field = failedCredential(error)
  const text = failureText(error)
  if (field) fieldErrors.value = { ...fieldErrors.value, [field]: text }
  if (!(error instanceof ApiError) || !(field || providerErrorKey(error))) return error
  return new ApiError(error.status, error.code, field ? '' : text, error.field, error.details)
}

const { draft, state, save, revert, reload } = useSettingsForm<PaymentProvider, ProviderDraft>({
  source: () => props.provider,
  read: ({ account_country }) => ({ account_country, credentials: {} }),
  save: async (values, latest) => {
    fieldErrors.value = {}
    const body: PaymentProviderUpdate = {}
    const credentials = credentialsPatch(values.credentials)
    if (Object.keys(credentials).length) body.credentials = credentials
    if (values.account_country && values.account_country !== latest.account_country) body.account_country = values.account_country
    if (!Object.keys(body).length) return latest
    try {
      const saved = await update.mutateAsync({ id: latest.id, body })
      toast.add({ title: t(body.credentials ? 'payments.credentials.saved' : 'payments.country.changed'), color: 'success' })
      return saved
    } catch (error) {
      throw refusal(error)
    }
  },
  reload: () => props.reloadProvider(),
})
onBeforeUnmount(() => { draft.value.credentials = {} })

// One gateway action at a time; every control waits for it, for a save, and for hydration.
const working = ref<'mode' | 'sync' | null>(null)
const locked = computed(() => !hydrated.value || !props.canEdit || working.value !== null || state.value.saving || state.value.reloading)

// What the last action left to say. `null` is nothing.
const modeFailure = ref<string | null>(null)
const syncFailure = ref<string | null>(null)
const syncOutcome = ref<PaymentProviderSyncStatus | null>(null)
const confirmingLive = ref(false)

function resetFeedback() {
  modeFailure.value = null
  syncFailure.value = null
  syncOutcome.value = null
}

async function run(action: 'mode' | 'sync', task: () => Promise<void>) {
  working.value = action
  try { await task() } finally { working.value = null }
}

function applyMode(next: PaymentProviderState) {
  if (locked.value) return
  resetFeedback()
  return run('mode', async () => {
    try {
      await update.mutateAsync({ id: props.provider.id, body: { state: next } })
      toast.add({ title: t('payments.mode.changed'), color: 'success' })
    } catch (error) {
      modeFailure.value = failureText(error)
    } finally {
      confirmingLive.value = false
    }
  })
}

// Going live takes real money, so it asks first; the other modes switch at once.
function chooseMode(value: string) {
  const next = paymentProviderState(value)
  if (!next || locked.value || next === props.provider.state) return
  if (next === 'enabled') {
    resetFeedback()
    confirmingLive.value = true
    return
  }
  confirmingLive.value = false
  return applyMode(next)
}

function testConnection() {
  if (!canTest.value) return
  resetFeedback()
  return run('sync', async () => {
    try {
      syncOutcome.value = (await sync.mutateAsync(props.provider.id)).status
    } catch (error) {
      syncFailure.value = failureText(error)
    }
  })
}

const stateBadge = computed(() => paymentStateBadge(props.provider.state))
const modes = computed(() => PAYMENT_PROVIDER_STATES.map(value => ({
  value,
  label: t(paymentStateBadge(value).labelKey),
  // A mode that takes payments needs every key first; the server refuses it otherwise.
  disabled: value !== 'disabled' && !props.provider.configured,
  testId: `payments-mode-${value}`,
})))
const countries = computed(() => props.provider.account_country_options.map(value => ({ value, label: countryName(value, locale.value) })))
// The test reads the saved keys from a gateway that is on: unsaved keys, missing keys and a gateway that is off have nothing to test.
// A gateway action (mode switch, connection test) and a credentials save both replace the cached provider, so the
// footer is busy while an action runs and a submit during one sends nothing.
function saveCredentials() {
  if (working.value === null) void save()
}

const canTest = computed(() => !locked.value && !state.value.dirty && props.provider.configured && props.provider.state !== 'disabled')
const testHint = computed(() => {
  if (state.value.dirty || !props.provider.configured) return t('payments.sync.saveFirst')
  return props.provider.state === 'disabled' ? t('payments.sync.turnOn') : ''
})
const outcome = computed(() => (syncOutcome.value ? SYNC_OUTCOMES[syncOutcome.value] : null))
function credentialLabel(field: string): string {
  const key = credentialLabelKey(field)
  return key ? t(key) : field
}
</script>

<template>
  <SharedSettingsCard
    :id="`provider-${provider.code}`"
    v-bind="state"
    :saving="state.saving || working !== null"
    :title="provider.name"
    :can-edit="canEdit"
    :data-testid="`payments-provider-${provider.code}`"
    @save="saveCredentials"
    @revert="revert"
    @reload="reload"
  >
    <template #actions>
      <SharedStatusBadge :tone="stateBadge.tone" :label="badgeLabel(stateBadge, provider.state, t)" data-testid="payments-state" />
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        icon="i-lucide-plug-zap"
        :loading="working === 'sync'"
        :disabled="!canTest"
        :label="t('payments.sync.action')"
        data-testid="payments-sync"
        @click="testConnection"
      />
    </template>

    <UFormField
      orientation="horizontal"
      :label="t('payments.mode.label')"
      :description="provider.configured ? t('payments.mode.hint') : `${t('payments.mode.hint')} ${t('payments.mode.needsKeys')}`"
    >
      <SharedSegmentedControl
        :model-value="provider.state"
        :items="modes"
        :label="t('payments.mode.label')"
        :disabled="locked"
        data-testid="payments-mode"
        @update:model-value="chooseMode"
      />
    </UFormField>
    <div v-if="confirmingLive || modeFailure !== null">
      <SharedInlineConfirm
        v-if="confirmingLive"
        color="warning"
        :title="t('payments.mode.liveTitle')"
        :description="t('payments.mode.liveHint', { gateway: provider.name })"
        :confirm-label="t('payments.mode.liveConfirm')"
        :pending="working === 'mode'"
        @confirm="applyMode('enabled')"
        @cancel="confirmingLive = false"
      />
      <UAlert v-else role="alert" color="error" variant="subtle" :title="t('payments.mode.failed')" :description="modeFailure || undefined" data-testid="payments-mode-error" />
    </div>

    <UFormField v-if="countries.length" orientation="horizontal" :label="t('payments.country.label')" :description="t('payments.country.hint')">
      <USelect
        :id="`${idBase}-country`"
        :model-value="draft.account_country ?? undefined"
        :items="countries"
        :disabled="locked"
        class="w-full sm:w-64"
        data-testid="payments-country"
        @update:model-value="draft.account_country = $event"
      />
    </UFormField>

    <div>
      <h3 class="text-sm font-semibold text-highlighted">{{ t('payments.credentials.title') }}</h3>
      <p class="mt-1 text-sm text-muted">{{ t('payments.credentials.hint', { gateway: provider.name }) }}</p>
    </div>
    <UFormField v-for="credential in provider.credentials" :key="credential.field" orientation="horizontal" :name="credential.field" :label="credentialLabel(credential.field)" :error="fieldErrors[credential.field]">
      <template #hint>
        <SharedStatusBadge size="sm" :tone="credential.present ? 'success' : 'neutral'" :label="t(credential.present ? 'payments.credentials.present' : 'payments.credentials.absent')" :data-testid="`payments-present-${credential.field}`" />
      </template>
      <UInput
        :id="`${idBase}-${credential.field}`"
        v-model="draft.credentials[credential.field]"
        type="password"
        autocomplete="new-password"
        dir="ltr"
        class="w-full"
        :placeholder="credential.present ? t('payments.credentials.keep') : undefined"
        :disabled="locked"
        :data-testid="`payments-credential-${credential.field}`"
      />
    </UFormField>
    <p v-if="testHint" class="text-sm text-muted">{{ testHint }}</p>
    <UAlert v-if="outcome" role="status" :color="outcome.color" variant="subtle" :title="t(outcome.titleKey)" :description="t(outcome.descriptionKey)" :data-testid="`payments-sync-${syncOutcome}`" />
    <UAlert v-if="syncFailure !== null" role="alert" color="error" variant="subtle" :title="t('payments.sync.failed')" :description="syncFailure || undefined" data-testid="payments-sync-error" />

    <UFormField orientation="horizontal" :label="t('payments.methods.label')">
      <ul v-if="provider.methods.length" class="flex flex-wrap gap-2" data-testid="payments-methods">
        <li v-for="method in provider.methods" :key="method" dir="ltr"><SharedStatusBadge tone="neutral" :label="method" /></li>
      </ul>
      <p v-else class="text-sm text-muted">{{ t('payments.methods.empty') }}</p>
    </UFormField>
  </SharedSettingsCard>
</template>
