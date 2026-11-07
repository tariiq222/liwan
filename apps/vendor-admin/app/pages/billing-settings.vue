<script setup lang="ts">
import { commercialErrorKey } from '@/utils/vendorCommercial'
definePageMeta({ capability: 'vendor.billing.manage' })
const { t } = useI18n(); const hydrated = useHydrated(); const { request } = useVendorApi(); const { can } = useVendorContext()
const canManage = computed(() => can('vendor.billing.manage'))
type Settings = {
  refund_window_days: number; bank_account_name: string; bank_account_number: string
  bank_iban: string; bank_instructions_ar: string; bank_instructions_en: string
}
const { data, error, pending, refresh } = await useAsyncData('vendor:billing-settings', () => request<Settings>('commercial/billing-settings'))
const draft = reactive({ refund_window_days: '', bank_account_name: '', bank_account_number: '', bank_iban: '', bank_instructions_ar: '', bank_instructions_en: '', reason: '' })
const original = ref('')
const serialized = () => JSON.stringify(draft)
const dirty = computed(() => original.value !== '' && serialized() !== original.value)
watch(data, (value) => {
  if (!value) return
  Object.assign(draft, {
    refund_window_days: String(value.refund_window_days), bank_account_name: value.bank_account_name, bank_account_number: value.bank_account_number,
    bank_iban: value.bank_iban, bank_instructions_ar: value.bank_instructions_ar, bank_instructions_en: value.bank_instructions_en, reason: '',
  })
  original.value = serialized()
}, { immediate: true })
const attempted = ref(false); const busy = ref(false); const failure = ref<unknown>(null); const saved = ref(false)
const errors = computed(() => {
  const e: Record<string, string> = {}
  const days = draft.refund_window_days.trim()
  if (!/^\d+$/.test(days) || Number(days) > 365) e.window = t('vendor.billingSettings.errors.window')
  const iban = draft.bank_iban.trim().toUpperCase()
  if (iban && !/^SA[0-9]{22}$/.test(iban)) e.iban = t('vendor.billingSettings.errors.iban')
  if (draft.reason.trim().length < 3) e.reason = t('vendor.pricing.reasonRequired')
  return e
})
const show = (k: string) => (attempted.value ? errors.value[k] : undefined)
async function submit() {
  if (!hydrated.value || busy.value || !canManage.value) return
  attempted.value = true
  if (Object.keys(errors.value).length) return
  busy.value = true; failure.value = null; saved.value = false
  try {
    await request('commercial/billing-settings', { method: 'PATCH', body: {
      refund_window_days: Number(draft.refund_window_days.trim()), bank_account_name: draft.bank_account_name.trim(),
      bank_account_number: draft.bank_account_number.trim(), bank_iban: draft.bank_iban.trim().toUpperCase(),
      bank_instructions_ar: draft.bank_instructions_ar.trim(), bank_instructions_en: draft.bank_instructions_en.trim(), reason: draft.reason.trim(),
    } })
    saved.value = true
    await refresh()
  } catch (cause) { failure.value = cause } finally { busy.value = false }
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
        <UFormField :label="t('vendor.pricing.fields.reason')" required :error="show('reason')"><UTextarea v-model="draft.reason" :maxlength="1000" class="w-full" :disabled="!hydrated || busy || !canManage" /></UFormField>
        <SharedFormActions>
          <UButton type="submit" :loading="busy" :disabled="!hydrated || !canManage">{{ t('vendor.billingSettings.save') }}</UButton>
        </SharedFormActions>
      </form>
    </SharedPageState>
  </SharedRecordPage>
</template>
