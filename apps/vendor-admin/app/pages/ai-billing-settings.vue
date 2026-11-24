<script setup lang="ts">
import { commercialErrorKey } from '@/utils/vendorCommercial'
import { aiBillingFromDraft, draftFromAiBilling, type AiBillingDraft, type AiBillingField } from '@/utils/vendorAiBilling'
import type { AiBillingSettings } from '@liwan/commercial-contracts'
definePageMeta({ capability: 'vendor.billing.manage' })
const { t } = useI18n(); const hydrated = useHydrated(); const { request } = useVendorApi(); const { can } = useVendorContext()
const canManage = computed(() => can('vendor.billing.manage'))
const { data, error, pending, refresh } = await useAsyncData('vendor:ai-billing-settings', () => request<AiBillingSettings>('commercial/ai-billing-settings'))
const draft = reactive<AiBillingDraft & { reason: string }>({ topup_amounts: '', topup_minimum: '', usd_rate: '', trial_allowance: '', monthly_allowance: '', reason: '' })
const original = ref('')
const serialized = () => JSON.stringify(draft)
const dirty = computed(() => original.value !== '' && serialized() !== original.value)
watch(data, (value) => {
  if (!value) return
  Object.assign(draft, draftFromAiBilling(value), { reason: '' })
  original.value = serialized()
}, { immediate: true })
const attempted = ref(false); const busy = ref(false); const failure = ref<unknown>(null); const saved = ref(false); const pushed = ref(0)
const checked = computed(() => aiBillingFromDraft(draft))
const fieldError = computed(() => (checked.value.ok ? null : checked.value.field))
const FIELD_OF: Record<AiBillingField, string> = { topup_amounts_minor: 'amounts', topup_minimum_minor: 'minimum', usd_rate: 'rate', trial_allowance_minor: 'trial', monthly_allowance_minor: 'monthly' }
const show = (name: AiBillingField) => (attempted.value && fieldError.value === name ? t(`vendor.aiBillingSettings.errors.${FIELD_OF[name]}`) : undefined)
const reasonError = computed(() => (attempted.value && draft.reason.trim().length < 3 ? t('vendor.pricing.reasonRequired') : undefined))
async function submit() {
  if (!hydrated.value || busy.value || !canManage.value) return
  attempted.value = true
  const result = checked.value
  if (!result.ok || draft.reason.trim().length < 3) return
  busy.value = true; failure.value = null; saved.value = false
  try {
    const reply = await request<AiBillingSettings & { pushed_tenants: number }>('commercial/ai-billing-settings', { method: 'PATCH', body: { ...result.settings, reason: draft.reason.trim() } })
    pushed.value = reply.pushed_tenants
  } catch (cause) { failure.value = cause; busy.value = false; return }
  saved.value = true
  // What was sent is now the stored record: a failed reload below must not leave it counted as unsaved.
  draft.reason = ''; original.value = serialized()
  try { await refresh() } finally { busy.value = false }
  // A failed reload is reported by the page state above, with its retry; it never sits next to «saved».
  if (error.value) saved.value = false
}
</script>
<template>
  <SharedRecordPage :title="t('vendor.aiBillingSettings.title')" :description="t('vendor.aiBillingSettings.hint')">
    <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
    <SharedPageState :loading="pending" :error="error" @retry="refresh">
      <form v-if="data" class="mx-auto grid max-w-2xl gap-(--liwan-gap-section)" novalidate @submit.prevent="submit">
        <UAlert v-if="failure" color="error" variant="subtle" :title="t(commercialErrorKey(failure))" data-testid="ai-billing-settings-failure" />
        <UAlert v-if="saved" color="success" variant="subtle" :title="t('vendor.aiBillingSettings.saved')" :description="pushed > 0 ? t('vendor.aiBillingSettings.pushed', { count: pushed }, pushed) : undefined" data-testid="ai-billing-settings-saved" />
        <SharedFormSection panel :title="t('vendor.aiBillingSettings.sections.topup')" :description="t('vendor.aiBillingSettings.sections.topupHint')">
          <UFormField :label="t('vendor.aiBillingSettings.fields.amounts')" :help="t('vendor.aiBillingSettings.fields.amountsHint')" required :error="show('topup_amounts_minor')">
            <UInput v-model="draft.topup_amounts" dir="ltr" inputmode="decimal" class="w-full" :disabled="!hydrated || busy || !canManage" />
          </UFormField>
          <UFormField :label="t('vendor.aiBillingSettings.fields.minimum')" :help="t('vendor.aiBillingSettings.fields.minimumHint')" required :error="show('topup_minimum_minor')">
            <UInput v-model="draft.topup_minimum" dir="ltr" inputmode="decimal" class="w-full sm:w-48" :disabled="!hydrated || busy || !canManage">
              <template #trailing><span class="text-xs text-muted">{{ t('vendor.pricing.sar') }}</span></template>
            </UInput>
          </UFormField>
          <UFormField :label="t('vendor.aiBillingSettings.fields.rate')" :help="t('vendor.aiBillingSettings.fields.rateHint')" required :error="show('usd_rate')">
            <UInput v-model="draft.usd_rate" dir="ltr" inputmode="decimal" class="w-full sm:w-48" :disabled="!hydrated || busy || !canManage" />
          </UFormField>
        </SharedFormSection>
        <SharedFormSection panel :title="t('vendor.aiBillingSettings.sections.allowances')" :description="t('vendor.aiBillingSettings.sections.allowancesHint')">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('vendor.aiBillingSettings.fields.trial')" required :error="show('trial_allowance_minor')">
              <UInput v-model="draft.trial_allowance" dir="ltr" inputmode="decimal" class="w-full" :disabled="!hydrated || busy || !canManage">
                <template #trailing><span class="text-xs text-muted">{{ t('vendor.pricing.sar') }}</span></template>
              </UInput>
            </UFormField>
            <UFormField :label="t('vendor.aiBillingSettings.fields.monthly')" required :error="show('monthly_allowance_minor')">
              <UInput v-model="draft.monthly_allowance" dir="ltr" inputmode="decimal" class="w-full" :disabled="!hydrated || busy || !canManage">
                <template #trailing><span class="text-xs text-muted">{{ t('vendor.pricing.sar') }}</span></template>
              </UInput>
            </UFormField>
          </div>
        </SharedFormSection>
        <UFormField :label="t('vendor.pricing.fields.reason')" required :error="reasonError"><UTextarea v-model="draft.reason" :maxlength="1000" class="w-full" :disabled="!hydrated || busy || !canManage" /></UFormField>
        <SharedFormActions>
          <UButton type="submit" :loading="busy" :disabled="!hydrated || !canManage">{{ t('vendor.aiBillingSettings.save') }}</UButton>
        </SharedFormActions>
      </form>
    </SharedPageState>
  </SharedRecordPage>
</template>
