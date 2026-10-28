<script setup lang="ts">
import type { PaymentProvider, PaymentProviderState, PaymentProviderSyncStatus } from '@webvue/contracts'
import { badgeLabel } from '@webvue/ui/app/utils/statusBadge'
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
import { saveErrorMessage } from '@/utils/formFeedback'

// One payment gateway the tenant connects with its own merchant account: its mode, the country of the account, its keys
// and its active methods. Keys are write-only: nothing the server sends back fills an input, only whether each key is saved.
// While the gateway is on, a change of mode, keys or country is checked against the gateway inside the same request, and a
// refusal saves nothing: the controls keep showing what is saved and the typed keys stay for another try.
const props = defineProps<{ provider: PaymentProvider }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const update = useUpdatePaymentProvider()
const sync = useSyncPaymentProvider()

const idBase = useId()
// One request at a time per gateway; every control waits for it, and for hydration.
const working = ref<'credentials' | 'mode' | 'country' | 'sync' | null>(null)
const busy = computed(() => !hydrated.value || working.value !== null)

const typed = reactive<Record<string, string>>({})
const patch = computed(() => credentialsPatch(typed))
const dirty = computed(() => Object.keys(patch.value).length > 0)
function clearTyped() {
  for (const field of Object.keys(typed)) delete typed[field]
}
onBeforeUnmount(clearTyped)

// What the last action left to say. `null` is nothing; '' is a failure whose reason an input already shows.
const fieldErrors = ref<Record<string, string>>({})
const credentialsFailure = ref<string | null>(null)
const modeFailure = ref<string | null>(null)
const countryFailure = ref<string | null>(null)
const syncFailure = ref<string | null>(null)
const syncOutcome = ref<PaymentProviderSyncStatus | null>(null)
const confirmingLive = ref(false)

function resetFeedback() {
  fieldErrors.value = {}
  credentialsFailure.value = null
  modeFailure.value = null
  countryFailure.value = null
  syncFailure.value = null
  syncOutcome.value = null
}

/** Puts a refusal on the input it names and returns the text still owed to the alert ('' when the input shows it). */
function failure(error: unknown): string {
  const key = providerErrorKey(error)
  const text = key ? t(key) : saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
  const field = failedCredential(error)
  if (!field) return text
  fieldErrors.value = { ...fieldErrors.value, [field]: text }
  return ''
}

async function run(action: 'credentials' | 'mode' | 'country' | 'sync', task: () => Promise<void>) {
  working.value = action
  try { await task() } finally { working.value = null }
}

function saveCredentials() {
  if (busy.value || !dirty.value) return
  resetFeedback()
  return run('credentials', async () => {
    try {
      await update.mutateAsync({ id: props.provider.id, body: { credentials: patch.value } })
      clearTyped()
      toast.add({ title: t('payments.credentials.saved'), color: 'success' })
    } catch (error) {
      credentialsFailure.value = failure(error)
    }
  })
}

function applyMode(state: PaymentProviderState) {
  if (busy.value) return
  resetFeedback()
  return run('mode', async () => {
    try {
      await update.mutateAsync({ id: props.provider.id, body: { state } })
      toast.add({ title: t('payments.mode.changed'), color: 'success' })
    } catch (error) {
      modeFailure.value = failure(error)
    } finally {
      confirmingLive.value = false
    }
  })
}

function chooseCountry(country: string) {
  if (busy.value || country === props.provider.account_country) return
  resetFeedback()
  return run('country', async () => {
    try {
      await update.mutateAsync({ id: props.provider.id, body: { account_country: country } })
      toast.add({ title: t('payments.country.changed'), color: 'success' })
    } catch (error) {
      countryFailure.value = failure(error)
    }
  })
}

// Going live takes real money, so it asks first; the other modes switch at once.
function chooseMode(value: string) {
  const state = paymentProviderState(value)
  if (!state || busy.value || state === props.provider.state) return
  if (state === 'enabled') {
    resetFeedback()
    confirmingLive.value = true
    return
  }
  confirmingLive.value = false
  return applyMode(state)
}

function testConnection() {
  if (!canTest.value) return
  resetFeedback()
  return run('sync', async () => {
    try {
      syncOutcome.value = (await sync.mutateAsync(props.provider.id)).status
    } catch (error) {
      syncFailure.value = failure(error)
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
const canTest = computed(() => !busy.value && !dirty.value && props.provider.configured && props.provider.state !== 'disabled')
const testHint = computed(() => {
  if (dirty.value || !props.provider.configured) return t('payments.sync.saveFirst')
  return props.provider.state === 'disabled' ? t('payments.sync.turnOn') : ''
})
const outcome = computed(() => (syncOutcome.value ? SYNC_OUTCOMES[syncOutcome.value] : null))
function credentialLabel(field: string): string {
  const key = credentialLabelKey(field)
  return key ? t(key) : field
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="provider.name" :data-testid="`payments-provider-${provider.code}`">
    <template #actions>
      <SharedStatusBadge :tone="stateBadge.tone" :label="badgeLabel(stateBadge, provider.state, t)" data-testid="payments-state" />
    </template>
    <SharedUnsavedChanges :dirty="dirty" />
    <div class="webvue-setting-rows">
      <UFormField
        orientation="horizontal"
        :label="t('payments.mode.label')"
        :description="t('payments.mode.hint')"
        :help="provider.configured ? undefined : t('payments.mode.needsKeys')"
      >
        <SharedSegmentedControl
          :model-value="provider.state"
          :items="modes"
          :label="t('payments.mode.label')"
          :disabled="busy"
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
          :model-value="provider.account_country ?? undefined"
          :items="countries"
          :disabled="busy"
          class="w-full sm:w-64"
          data-testid="payments-country"
          @update:model-value="chooseCountry"
        />
      </UFormField>
      <div v-if="countryFailure !== null">
        <UAlert role="alert" color="error" variant="subtle" :title="t('payments.country.failed')" :description="countryFailure || undefined" data-testid="payments-country-error" />
      </div>

      <UForm novalidate :state="typed" class="grid gap-4" @submit="saveCredentials">
        <div>
          <h3 class="text-sm font-semibold text-highlighted">{{ t('payments.credentials.title') }}</h3>
          <p class="mt-1 text-sm text-muted">{{ t('payments.credentials.hint', { gateway: provider.name }) }}</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField v-for="credential in provider.credentials" :key="credential.field" :name="credential.field" :label="credentialLabel(credential.field)" :error="fieldErrors[credential.field]">
            <template #hint>
              <SharedStatusBadge size="sm" :tone="credential.present ? 'success' : 'neutral'" :label="t(credential.present ? 'payments.credentials.present' : 'payments.credentials.absent')" :data-testid="`payments-present-${credential.field}`" />
            </template>
            <UInput
              :id="`${idBase}-${credential.field}`"
              v-model="typed[credential.field]"
              type="password"
              autocomplete="new-password"
              dir="ltr"
              class="w-full"
              :placeholder="credential.present ? t('payments.credentials.keep') : undefined"
              :disabled="busy"
              :data-testid="`payments-credential-${credential.field}`"
            />
          </UFormField>
        </div>
        <UAlert v-if="credentialsFailure !== null" role="alert" color="error" variant="subtle" :title="t('payments.credentials.failed')" :description="credentialsFailure || undefined" data-testid="payments-credentials-error" />
        <div class="flex flex-wrap items-center gap-2">
          <UButton type="submit" :loading="working === 'credentials'" :disabled="busy || !dirty" :label="t('payments.credentials.save')" data-testid="payments-save" />
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
        </div>
        <p v-if="testHint" class="text-sm text-muted">{{ testHint }}</p>
        <UAlert v-if="outcome" role="status" :color="outcome.color" variant="subtle" :title="t(outcome.titleKey)" :description="t(outcome.descriptionKey)" :data-testid="`payments-sync-${syncOutcome}`" />
        <UAlert v-if="syncFailure !== null" role="alert" color="error" variant="subtle" :title="t('payments.sync.failed')" :description="syncFailure || undefined" data-testid="payments-sync-error" />
      </UForm>

      <div>
        <h3 class="text-sm font-semibold text-highlighted">{{ t('payments.methods.label') }}</h3>
        <ul v-if="provider.methods.length" class="mt-2 flex flex-wrap gap-2" data-testid="payments-methods">
          <li v-for="method in provider.methods" :key="method" dir="ltr"><SharedStatusBadge tone="neutral" :label="method" /></li>
        </ul>
        <p v-else class="mt-1 text-sm text-muted">{{ t('payments.methods.empty') }}</p>
      </div>
    </div>
  </SharedRecordSection>
</template>
