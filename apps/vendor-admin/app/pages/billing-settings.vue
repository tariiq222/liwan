<script setup lang="ts">
import { commercialErrorKey, minorToInput, parseCount, parseVendorMoneyInput } from '@/utils/vendorCommercial'
definePageMeta({ capability: 'vendor.billing.manage' })
const { t } = useI18n(); const hydrated = useHydrated(); const { request } = useVendorApi(); const { can } = useVendorContext()
const canManage = computed(() => can('vendor.billing.manage'))
const locked = computed(() => !hydrated.value || busy.value || !canManage.value)
type Settings = {
  refund_window_days: number; onboarding_fee_minor: number; onboarding_exponent: number; bank_account_name: string; bank_account_number: string
  bank_iban: string; bank_instructions_ar: string; bank_instructions_en: string
} & Record<SellerField, string>
/** The seller identity printed on every invoice. There is no tax number: the vendor is not VAT-registered. */
const SELLER_FIELDS = ['seller_legal_name_ar', 'seller_legal_name_en', 'seller_commercial_registration', 'seller_address', 'seller_city', 'seller_country', 'seller_email', 'seller_phone'] as const
type SellerField = typeof SELLER_FIELDS[number]
const emptySeller = () => Object.fromEntries(SELLER_FIELDS.map(field => [field, ''])) as Record<SellerField, string>
const { data, error, pending, refresh } = await useAsyncData('vendor:billing-settings', () => request<Settings>('commercial/billing-settings'))
const draft = reactive({ refund_window_days: '', onboarding_fee: '', bank_account_name: '', bank_account_number: '', bank_iban: '', bank_instructions_ar: '', bank_instructions_en: '', ...emptySeller(), reason: '' })
const original = ref('')
const attempted = ref(false); const busy = ref(false); const failure = ref<unknown>(null); const saved = ref(false)
// The audit reason is typed per save and never counts as an edit: only the settings themselves make the page "unsaved".
const serialized = () => JSON.stringify({ ...draft, reason: '' })
const dirty = computed(() => original.value !== '' && serialized() !== original.value)
/** The fee and exponent as last loaded from the server, so an untouched field is never re-sent. */
let loadedFee: { minor: number; exponent: number } | null = null
/** The fee field as loaded: an unchanged value is never judged, so a stored fee with fractional riyals cannot block saving another setting. */
let loadedFeeText = ''
/** Puts the stored settings back in the form (a load, a refetch, or «Revert») and forgets every message about the last attempt. */
function reset() {
  const value = data.value
  if (!value) return
  loadedFeeText = value.onboarding_exponent === undefined ? '' : feeInput(value.onboarding_fee_minor, value.onboarding_exponent)
  Object.assign(draft, {
    refund_window_days: String(value.refund_window_days), onboarding_fee: loadedFeeText,
    bank_account_name: value.bank_account_name, bank_account_number: value.bank_account_number,
    bank_iban: value.bank_iban, bank_instructions_ar: value.bank_instructions_ar, bank_instructions_en: value.bank_instructions_en,
    ...Object.fromEntries(SELLER_FIELDS.map(field => [field, value[field]])), reason: '',
  })
  original.value = serialized(); attempted.value = false; failure.value = null
  loadedFee = value.onboarding_exponent === undefined ? null : { minor: value.onboarding_fee_minor, exponent: value.onboarding_exponent }
}
watch(data, reset, { immediate: true })
// The first edit after a save ends the «saved» message: it no longer describes what is on the screen.
watch(dirty, (edited) => { if (edited) saved.value = false })
const failureMessage = computed(() => (failure.value ? t(commercialErrorKey(failure.value)) : ''))
/** The stored fee as the whole amount the field takes; a row with minor units outside the major unit keeps its full form. */
function feeInput(minor: number, exponent: number): string {
  return minor % 10 ** exponent === 0 ? String(minor / 10 ** exponent) : minorToInput(minor, exponent)
}
/** The whole major amount the vendor types (Arabic-Indic digits included) — never a fraction of the major unit. */
function isWholeAmount(text: string): boolean {
  if (!text) return false
  for (const char of text) {
    const ascii = char >= '0' && char <= '9'
    const arabic = char >= '٠' && char <= '٩'
    if (!ascii && !arabic) return false
  }
  return true
}
/** The fee in minor units of the loaded exponent, or null unless the field is a non-negative whole amount in the major unit. */
function onboardingFeeMinor(): number | null {
  const exponent = loadedFee?.exponent
  if (exponent === undefined) return null
  return parseVendorMoneyInput(draft.onboarding_fee, exponent)
}
/** An IBAN is pasted grouped in fours: the spaces are layout, so the value is judged and sent without them. */
const normalizedIban = () => draft.bank_iban.replace(/\s+/g, '').toUpperCase()
const errors = computed(() => {
  const e: Record<string, string> = {}
  if (parseCount(draft.refund_window_days, 365) === null) e.window = t('vendor.billingSettings.errors.window')
  // The fee must be a whole major-unit amount when it is typed. Leaving the stored value untouched is valid: it is
  // simply omitted from the PATCH (see onboardingFeeChange), so it must not block saving an unrelated setting.
  const fee = draft.onboarding_fee.trim()
  if (fee && fee !== loadedFeeText && (isWholeAmount(fee) === false || onboardingFeeMinor() === null)) e.onboardingFee = t('vendor.billingSettings.errors.onboardingFee')
  const iban = normalizedIban()
  if (iban && !/^SA[0-9]{22}$/.test(iban)) e.iban = t('vendor.billingSettings.errors.iban')
  if (draft.seller_email.trim() && !/^\S+@\S+\.\S+$/.test(draft.seller_email.trim())) e.sellerEmail = t('vendor.billingSettings.errors.sellerEmail')
  if (draft.reason.trim().length < 3) e.reason = t('vendor.billingSettings.errors.reason')
  return e
})
/** Blank keeps the stored fee; 0 is sent as such and means no customer is offered onboarding. */
function onboardingFeeChange(): { onboarding_fee_minor?: number } {
  const minor = onboardingFeeMinor()
  if (minor === null) return {}
  if (Boolean(loadedFee) && minor === loadedFee!.minor) return {}
  return { onboarding_fee_minor: minor }
}
const summary = ref<{ focus: () => void } | null>(null)
/** The error summary: one line per wrong field, in form order, each a link to its field (the field's `name`). */
const FORM_ORDER = ['window', 'iban', 'sellerEmail', 'onboardingFee', 'reason']
const summaryErrors = computed(() => (attempted.value ? FORM_ORDER.filter(field => errors.value[field]).map(field => ({ field, message: errors.value[field]! })) : []))
async function submit() {
  if (locked.value || !dirty.value) return
  failure.value = null
  attempted.value = true
  if (Object.keys(errors.value).length) { await nextTick(); summary.value?.focus(); return }
  busy.value = true; failure.value = null; saved.value = false
  try {
    await request('commercial/billing-settings', { method: 'PATCH', body: {
      refund_window_days: parseCount(draft.refund_window_days, 365), ...onboardingFeeChange(), bank_account_name: draft.bank_account_name.trim(),
      bank_account_number: draft.bank_account_number.trim(), bank_iban: normalizedIban(),
      bank_instructions_ar: draft.bank_instructions_ar.trim(), bank_instructions_en: draft.bank_instructions_en.trim(),
      ...Object.fromEntries(SELLER_FIELDS.map(field => [field, draft[field].trim()])), reason: draft.reason.trim(),
    } })
  } catch (cause) { failure.value = cause; busy.value = false; return }
  saved.value = true
  // What was sent is now the stored record: a failed reload below must not leave it counted as unsaved.
  draft.reason = ''; original.value = serialized()
  // The saved draft starts over (the data watch clears the reason): its required-field errors are shown again only on the next attempt.
  attempted.value = false
  try { await refresh() } finally { busy.value = false }
  // A failed reload is reported by the page state above, with its retry; it never sits next to «saved».
  if (error.value) saved.value = false
}
</script>
<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('vendor.billingSettings.title')" :description="t('vendor.billingSettings.hint')" />
    <SharedPageState :loading="pending && !data" :error="error" :empty="!pending && !error && !data" @retry="refresh">
      <SharedSettingsCard
        v-if="data"
        id="billing"
        :title="t('vendor.billingSettings.sections.refund')"
        :can-edit="canManage"
        :dirty="dirty"
        :saving="busy"
        :message="failureMessage"
        data-testid="billing-settings-card"
        @save="submit"
        @revert="reset"
      >
        <SharedErrorSummary ref="summary" :title="t('vendor.billingSettings.errorSummary')" :errors="summaryErrors" />
        <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
          <SharedFormField name="window" :label="t('vendor.billingSettings.fields.window')" :help="t('vendor.billingSettings.fields.windowHint')" required :error="errors.window" :submitted="attempted">
            <UInput v-model="draft.refund_window_days" inputmode="numeric" dir="ltr" class="w-full" :disabled="locked" />
          </SharedFormField>
        </div>
        <SharedRecordSection :title="t('vendor.billingSettings.sections.bank')" :description="t('vendor.billingSettings.sections.bankHint')">
          <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
            <SharedFormField name="accountName" :label="t('vendor.billingSettings.fields.accountName')"><UInput v-model="draft.bank_account_name" class="w-full" :disabled="locked" /></SharedFormField>
            <SharedFormField name="accountNumber" :label="t('vendor.billingSettings.fields.accountNumber')"><UInput v-model="draft.bank_account_number" dir="ltr" class="w-full" :disabled="locked" /></SharedFormField>
            <SharedFormField name="iban" :label="t('vendor.billingSettings.fields.iban')" :help="t('vendor.billingSettings.fields.ibanHint')" :error="errors.iban" :submitted="attempted"><UInput v-model="draft.bank_iban" dir="ltr" class="w-full" :disabled="locked" /></SharedFormField>
            <SharedFormField name="instructionsAr" :label="t('vendor.billingSettings.fields.instructionsAr')"><UTextarea v-model="draft.bank_instructions_ar" :maxlength="500" class="w-full" :disabled="locked" /></SharedFormField>
            <SharedFormField name="instructionsEn" :label="t('vendor.billingSettings.fields.instructionsEn')"><UTextarea v-model="draft.bank_instructions_en" :maxlength="500" dir="ltr" class="w-full" :disabled="locked" /></SharedFormField>
          </div>
        </SharedRecordSection>
        <SharedRecordSection :title="t('vendor.billingSettings.sections.seller')" :description="t('vendor.billingSettings.sections.sellerHint')">
          <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
            <SharedFormField name="sellerNameAr" :label="t('vendor.billingSettings.fields.sellerNameAr')"><UInput v-model="draft.seller_legal_name_ar" maxlength="200" class="w-full" :disabled="locked" /></SharedFormField>
            <SharedFormField name="sellerNameEn" :label="t('vendor.billingSettings.fields.sellerNameEn')"><UInput v-model="draft.seller_legal_name_en" dir="ltr" maxlength="200" class="w-full" :disabled="locked" /></SharedFormField>
            <SharedFormField name="sellerRegistration" :label="t('vendor.billingSettings.fields.sellerRegistration')"><UInput v-model="draft.seller_commercial_registration" dir="ltr" maxlength="64" class="w-full" :disabled="locked" /></SharedFormField>
            <SharedFormField name="sellerPhone" :label="t('vendor.billingSettings.fields.sellerPhone')"><UInput v-model="draft.seller_phone" dir="ltr" maxlength="40" class="w-full" :disabled="locked" /></SharedFormField>
            <SharedFormField name="sellerEmail" :label="t('vendor.billingSettings.fields.sellerEmail')" :error="errors.sellerEmail" :submitted="attempted"><UInput v-model="draft.seller_email" type="email" dir="ltr" maxlength="200" class="w-full" :disabled="locked" /></SharedFormField>
            <SharedFormField name="sellerCity" :label="t('vendor.billingSettings.fields.sellerCity')"><UInput v-model="draft.seller_city" maxlength="100" class="w-full" :disabled="locked" /></SharedFormField>
            <SharedFormField name="sellerCountry" :label="t('vendor.billingSettings.fields.sellerCountry')"><UInput v-model="draft.seller_country" maxlength="100" class="w-full" :disabled="locked" /></SharedFormField>
            <SharedFormField name="sellerAddress" :label="t('vendor.billingSettings.fields.sellerAddress')" :help="t('vendor.billingSettings.fields.sellerAddressHint')"><UTextarea v-model="draft.seller_address" :maxlength="500" class="w-full" :disabled="locked" /></SharedFormField>
          </div>
        </SharedRecordSection>
        <SharedRecordSection :title="t('vendor.billingSettings.sections.onboarding')">
          <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
            <SharedMoneyField v-model="draft.onboarding_fee" name="onboardingFee" whole :label="t('vendor.billingSettings.fields.onboardingFee')" :help="t('vendor.billingSettings.fields.onboardingFeeHint')" :unit="t('vendor.pricing.sar')" :unit-label="t('vendor.pricing.sarName')" :error="errors.onboardingFee" :submitted="attempted" :disabled="locked" />
          </div>
        </SharedRecordSection>
        <SharedFormField name="reason" :label="t('vendor.billingSettings.fields.reason')" :help="t('vendor.billingSettings.fields.reasonHint')" :error="dirty ? errors.reason : undefined" :submitted="attempted" required>
          <UTextarea v-model="draft.reason" :maxlength="1000" class="w-full" :disabled="locked" />
        </SharedFormField>
        <!-- The live region stays mounted so the result is announced when it appears; «saved» ends with the first edit. -->
        <div role="status" aria-live="polite" aria-atomic="true" data-testid="billing-settings-status">
          <UAlert v-if="saved" color="success" variant="subtle" :title="t('vendor.billingSettings.saved')" data-testid="billing-settings-saved" />
        </div>
      </SharedSettingsCard>
    </SharedPageState>
  </SharedSettingsPage>
</template>
