<script setup lang="ts">
import { commercialErrorKey } from '@/utils/vendorCommercial'
import { AI_BILLING_FIELDS, aiBillingFromDraft, aiBillingInvalidFields, draftFromAiBilling, topupRowErrors, type AiBillingDraft, type AiBillingField } from '@/utils/vendorAiBilling'
import type { AiBillingSettings } from '@liwan/commercial-contracts'
definePageMeta({ capability: 'vendor.billing.manage' })
const { t } = useI18n(); const hydrated = useHydrated(); const { request } = useVendorApi(); const { can } = useVendorContext()
const canManage = computed(() => can('vendor.billing.manage'))
const locked = computed(() => !hydrated.value || busy.value || !canManage.value)
const { data, error, pending, refresh } = await useAsyncData('vendor:ai-billing-settings', () => request<AiBillingSettings>('commercial/ai-billing-settings'))
const draft = reactive<AiBillingDraft & { reason: string }>({ topup_amounts: [''], topup_minimum: '', usd_rate: '', trial_allowance: '', monthly_allowance: '', reason: '' })
const original = ref('')
// The audit reason is typed per save and never counts as an edit: only the settings themselves make the page "unsaved".
const serialized = () => JSON.stringify({ ...draft, reason: '' })
const dirty = computed(() => original.value !== '' && serialized() !== original.value)
const attempted = ref(false); const busy = ref(false); const failure = ref<unknown>(null); const saved = ref(false); const pushed = ref(0)
/** Puts the stored settings back in the form (a load, a refetch, or «Revert») and forgets every message about the last attempt. */
function reset() {
  if (!data.value) return
  Object.assign(draft, draftFromAiBilling(data.value), { reason: '' })
  original.value = serialized(); attempted.value = false; failure.value = null
}
watch(data, reset, { immediate: true })
// The first edit after a save ends the «saved» message: it no longer describes what is on the screen.
watch(dirty, (edited) => { if (edited) saved.value = false })
const failureMessage = computed(() => (failure.value ? t(commercialErrorKey(failure.value)) : ''))
const checked = computed(() => aiBillingFromDraft(draft))
const invalid = computed(() => new Set(aiBillingInvalidFields(draft)))
const FIELD_OF: Record<AiBillingField, string> = { topup_amounts_minor: 'amounts', topup_minimum_minor: 'minimum', usd_rate: 'rate', trial_allowance_minor: 'trial', monthly_allowance_minor: 'monthly' }
// Each field's own message (SharedFormField shows it after blur or once a save was attempted); the list of amounts names its wrong rows.
const errorOf = (name: AiBillingField) => (invalid.value.has(name) ? t(`vendor.aiBillingSettings.errors.${FIELD_OF[name]}`) : undefined)
const amountRowErrors = computed(() => topupRowErrors(draft.topup_amounts).map(bad => (bad ? t('vendor.aiBillingSettings.errors.amountRow') : undefined)))
const amountsListError = computed(() => (amountRowErrors.value.some(Boolean) ? undefined : errorOf('topup_amounts_minor')))
const reasonError = computed(() => (draft.reason.trim().length < 3 ? t('vendor.aiBillingSettings.errors.reason') : undefined))
const summary = ref<{ focus: () => void } | null>(null)
// The error summary: one line per wrong field, in form order, each a link to its field.
const summaryErrors = computed(() => {
  if (!attempted.value) return []
  const items: { field: string, message: string }[] = []
  const rowMessage = amountRowErrors.value.find(Boolean)
  const add = (field: AiBillingField) => { const message = field === 'topup_amounts_minor' ? rowMessage ?? errorOf(field) : errorOf(field); if (message) items.push({ field: FIELD_OF[field], message }) }
  AI_BILLING_FIELDS.forEach(add)
  if (reasonError.value) items.push({ field: 'reason', message: reasonError.value })
  return items
})
async function submit() {
  if (locked.value || !dirty.value) return
  failure.value = null
  attempted.value = true
  const result = checked.value
  if (!result.ok || draft.reason.trim().length < 3) { await nextTick(); summary.value?.focus(); return }
  busy.value = true; failure.value = null; saved.value = false
  try {
    const reply = await request<AiBillingSettings & { pushed_tenants: number }>('commercial/ai-billing-settings', { method: 'PATCH', body: { ...result.settings, reason: draft.reason.trim() } })
    pushed.value = reply.pushed_tenants
  } catch (cause) { failure.value = cause; busy.value = false; return }
  saved.value = true
  // What was sent is now the stored record: a failed reload below must not leave it counted as unsaved.
  draft.reason = ''; original.value = serialized(); attempted.value = false
  try { await refresh() } finally { busy.value = false }
  // A failed reload is reported by the page state above, with its retry; it never sits next to «saved».
  if (error.value) saved.value = false
}
</script>
<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('vendor.aiBillingSettings.title')" :description="t('vendor.aiBillingSettings.hint')" />
    <SharedPageState :loading="pending && !data" :error="error" :empty="!pending && !error && !data" @retry="refresh">
      <SharedSettingsCard
        v-if="data"
        id="ai-billing"
        :title="t('vendor.aiBillingSettings.sections.topup')"
        :description="t('vendor.aiBillingSettings.sections.topupHint')"
        :can-edit="canManage"
        :dirty="dirty"
        :saving="busy"
        :message="failureMessage"
        data-testid="ai-billing-settings-card"
        @save="submit"
        @revert="reset"
      >
        <SharedErrorSummary ref="summary" :title="t('vendor.aiBillingSettings.errorSummary')" :errors="summaryErrors" />
        <SharedMoneyListField
          v-model="draft.topup_amounts"
          name="amounts"
          :label="t('vendor.aiBillingSettings.fields.amounts')"
          :help="t('vendor.aiBillingSettings.fields.amountsHint')"
          :row-label="t('vendor.aiBillingSettings.fields.amountRow')"
          :add-label="t('vendor.aiBillingSettings.fields.addAmount')"
          :remove-label="t('vendor.aiBillingSettings.fields.removeAmount')"
          :unit="t('vendor.pricing.sar')"
          :unit-label="t('vendor.pricing.sarName')"
          :errors="amountRowErrors"
          :error="amountsListError"
          :submitted="attempted"
          :max="12"
          required
          :disabled="locked"
        />
        <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
          <SharedMoneyField v-model="draft.topup_minimum" name="minimum" :label="t('vendor.aiBillingSettings.fields.minimum')" :help="t('vendor.aiBillingSettings.fields.minimumHint')" :unit="t('vendor.pricing.sar')" :unit-label="t('vendor.pricing.sarName')" :error="errorOf('topup_minimum_minor')" :submitted="attempted" required :disabled="locked" />
          <SharedFormField name="rate" :label="t('vendor.aiBillingSettings.fields.rate')" :help="t('vendor.aiBillingSettings.fields.rateHint')" :error="errorOf('usd_rate')" :submitted="attempted" required>
            <UInput v-model="draft.usd_rate" dir="ltr" inputmode="decimal" class="w-full" :disabled="locked" />
          </SharedFormField>
        </div>
        <SharedRecordSection :title="t('vendor.aiBillingSettings.sections.allowances')" :description="t('vendor.aiBillingSettings.sections.allowancesHint')">
          <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
            <SharedMoneyField v-model="draft.trial_allowance" name="trial" :label="t('vendor.aiBillingSettings.fields.trial')" :unit="t('vendor.pricing.sar')" :unit-label="t('vendor.pricing.sarName')" :error="errorOf('trial_allowance_minor')" :submitted="attempted" required :disabled="locked" />
            <SharedMoneyField v-model="draft.monthly_allowance" name="monthly" :label="t('vendor.aiBillingSettings.fields.monthly')" :unit="t('vendor.pricing.sar')" :unit-label="t('vendor.pricing.sarName')" :error="errorOf('monthly_allowance_minor')" :submitted="attempted" required :disabled="locked" />
          </div>
        </SharedRecordSection>
        <SharedFormField name="reason" :label="t('vendor.aiBillingSettings.fields.reason')" :help="t('vendor.aiBillingSettings.fields.reasonHint')" :error="dirty ? reasonError : undefined" :submitted="attempted" required>
          <UTextarea v-model="draft.reason" :maxlength="1000" class="w-full" :disabled="locked" />
        </SharedFormField>
        <!-- The live region stays mounted so the result is announced when it appears; «saved» ends with the first edit. -->
        <div role="status" aria-live="polite" aria-atomic="true" data-testid="ai-billing-settings-status">
          <UAlert v-if="saved" color="success" variant="subtle" :title="t('vendor.aiBillingSettings.saved')" :description="t('vendor.aiBillingSettings.pushed', { count: pushed }, pushed)" data-testid="ai-billing-settings-saved" />
        </div>
      </SharedSettingsCard>
    </SharedPageState>
  </SharedSettingsPage>
</template>
