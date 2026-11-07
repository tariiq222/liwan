<script setup lang="ts">
import { commercialErrorKey, minorToInput, parseCount, parseVendorMoneyInput } from '@/utils/vendorCommercial'
definePageMeta({ capability: 'vendor.billing.manage' })
const { t } = useI18n(); const hydrated = useHydrated(); const { request } = useVendorApi(); const { can } = useVendorContext()
const canManage = computed(() => can('vendor.billing.manage'))
type Settings = {
  refund_window_days: number; onboarding_fee_minor: number; onboarding_exponent: number; bank_account_name: string; bank_account_number: string
  bank_iban: string; bank_instructions_ar: string; bank_instructions_en: string
}
const { data, error, pending, refresh } = await useAsyncData('vendor:billing-settings', () => request<Settings>('commercial/billing-settings'))
const draft = reactive({ refund_window_days: '', onboarding_fee: '', bank_account_name: '', bank_account_number: '', bank_iban: '', bank_instructions_ar: '', bank_instructions_en: '', reason: '' })
const original = ref('')
const serialized = () => JSON.stringify(draft)
const dirty = computed(() => original.value !== '' && serialized() !== original.value)
/** The fee and exponent as last loaded from the server, so an untouched field is never re-sent. */
let loadedFee: { minor: number; exponent: number } | null = null
/** The fee field as loaded: an unchanged value is never judged, so a stored fee with fractional riyals cannot block saving another setting. */
let loadedFeeText = ''
watch(data, (value) => {
  if (!value) return
  loadedFeeText = value.onboarding_exponent === undefined ? '' : feeInput(value.onboarding_fee_minor, value.onboarding_exponent)
  Object.assign(draft, {
    refund_window_days: String(value.refund_window_days), onboarding_fee: loadedFeeText,
    bank_account_name: value.bank_account_name, bank_account_number: value.bank_account_number,
    bank_iban: value.bank_iban, bank_instructions_ar: value.bank_instructions_ar, bank_instructions_en: value.bank_instructions_en, reason: '',
  })
  original.value = serialized()
  loadedFee = value.onboarding_exponent === undefined ? null : { minor: value.onboarding_fee_minor, exponent: value.onboarding_exponent }
}, { immediate: true })
const attempted = ref(false); const busy = ref(false); const failure = ref<unknown>(null); const saved = ref(false)
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
const errors = computed(() => {
  const e: Record<string, string> = {}
  if (parseCount(draft.refund_window_days, 365) === null) e.window = t('vendor.billingSettings.errors.window')
  // The fee must be a whole major-unit amount when it is typed. Leaving the stored value untouched is valid: it is
  // simply omitted from the PATCH (see onboardingFeeChange), so it must not block saving an unrelated setting.
  const fee = draft.onboarding_fee.trim()
  if (fee && fee !== loadedFeeText && (isWholeAmount(fee) === false || onboardingFeeMinor() === null)) e.onboardingFee = t('vendor.billingSettings.errors.onboardingFee')
  const iban = draft.bank_iban.trim().toUpperCase()
  if (iban && !/^SA[0-9]{22}$/.test(iban)) e.iban = t('vendor.billingSettings.errors.iban')
  if (draft.reason.trim().length < 3) e.reason = t('vendor.pricing.reasonRequired')
  return e
})
const show = (k: string) => (attempted.value ? errors.value[k] : undefined)
/** Blank keeps the stored fee; 0 is sent as such and means no customer is offered onboarding. */
function onboardingFeeChange(): { onboarding_fee_minor?: number } {
  const minor = onboardingFeeMinor()
  if (minor === null) return {}
  if (Boolean(loadedFee) && minor === loadedFee!.minor) return {}
  return { onboarding_fee_minor: minor }
}
async function submit() {
  if (!hydrated.value || busy.value || !canManage.value) return
  attempted.value = true
  if (Object.keys(errors.value).length) return
  busy.value = true; failure.value = null; saved.value = false
  try {
    await request('commercial/billing-settings', { method: 'PATCH', body: {
      refund_window_days: parseCount(draft.refund_window_days, 365), ...onboardingFeeChange(), bank_account_name: draft.bank_account_name.trim(),
      bank_account_number: draft.bank_account_number.trim(), bank_iban: draft.bank_iban.trim().toUpperCase(),
      bank_instructions_ar: draft.bank_instructions_ar.trim(), bank_instructions_en: draft.bank_instructions_en.trim(), reason: draft.reason.trim(),
    } })
  } catch (cause) { failure.value = cause; busy.value = false; return }
  saved.value = true
  try { await refresh() } finally { busy.value = false }
  // A failed reload is reported by the page state above, with its retry; it never sits next to «saved».
  if (error.value) saved.value = false
}
</script>
<template>
  <SharedRecordPage :title="t('vendor.billingSettings.title')" :description="t('vendor.billingSettings.hint')">
    <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
    <SharedPageState :loading="pending" :error="error" @retry="refresh">
      <form v-if="data" class="mx-auto grid max-w-2xl gap-6" novalidate @submit.prevent="submit">
        <UAlert v-if="failure" color="error" variant="subtle" :title="t(commercialErrorKey(failure))" data-testid="billing-settings-failure" />
        <UAlert v-if="saved" color="success" variant="subtle" :title="t('vendor.billingSettings.saved')" data-testid="billing-settings-saved" />
        <SharedFormSection panel :title="t('vendor.billingSettings.sections.refund')">
          <UFormField :label="t('vendor.billingSettings.fields.window')" :help="t('vendor.billingSettings.fields.windowHint')" required :error="show('window')">
            <UInput v-model="draft.refund_window_days" inputmode="numeric" dir="ltr" class="w-full" :disabled="!hydrated || busy || !canManage" />
          </UFormField>
        </SharedFormSection>
        <SharedFormSection panel :title="t('vendor.billingSettings.sections.bank')" :description="t('vendor.billingSettings.sections.bankHint')">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('vendor.billingSettings.fields.accountName')"><UInput v-model="draft.bank_account_name" class="w-full" :disabled="!hydrated || busy || !canManage" /></UFormField>
            <UFormField :label="t('vendor.billingSettings.fields.accountNumber')"><UInput v-model="draft.bank_account_number" dir="ltr" class="w-full" :disabled="!hydrated || busy || !canManage" /></UFormField>
          </div>
          <UFormField :label="t('vendor.billingSettings.fields.iban')" :help="t('vendor.billingSettings.fields.ibanHint')" :error="show('iban')"><UInput v-model="draft.bank_iban" dir="ltr" maxlength="24" class="w-full" :disabled="!hydrated || busy || !canManage" /></UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('vendor.billingSettings.fields.instructionsAr')"><UTextarea v-model="draft.bank_instructions_ar" :maxlength="500" class="w-full" :disabled="!hydrated || busy || !canManage" /></UFormField>
            <UFormField :label="t('vendor.billingSettings.fields.instructionsEn')"><UTextarea v-model="draft.bank_instructions_en" :maxlength="500" dir="ltr" class="w-full" :disabled="!hydrated || busy || !canManage" /></UFormField>
          </div>
        </SharedFormSection>
        <SharedFormSection panel :title="t('vendor.billingSettings.sections.onboarding')">
          <UFormField :label="t('vendor.billingSettings.fields.onboardingFee')" :help="t('vendor.billingSettings.fields.onboardingFeeHint')" :error="show('onboardingFee')">
            <UInput v-model="draft.onboarding_fee" dir="ltr" inputmode="numeric" class="w-full sm:w-48" :disabled="!hydrated || busy || !canManage">
              <template #trailing><span class="text-xs text-muted">{{ t('vendor.pricing.sar') }}</span></template>
            </UInput>
          </UFormField>
        </SharedFormSection>
        <UFormField :label="t('vendor.pricing.fields.reason')" required :error="show('reason')"><UTextarea v-model="draft.reason" :maxlength="1000" class="w-full" :disabled="!hydrated || busy || !canManage" /></UFormField>
        <SharedFormActions>
          <UButton type="submit" :loading="busy" :disabled="!hydrated || !canManage">{{ t('vendor.billingSettings.save') }}</UButton>
        </SharedFormActions>
      </form>
    </SharedPageState>
  </SharedRecordPage>
</template>
