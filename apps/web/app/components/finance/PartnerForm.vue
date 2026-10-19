<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'
import type { FinancePartnerKind } from '@/composables/finance/financePartnerParams'
import { useCreateFinancePartner, useFinanceCountries, useFinanceStates, useUpdateFinancePartner, type FinancePartner } from '@/composables/finance/useFinancePartners'

const props = defineProps<{
  partner?: FinancePartner | null
  backTo: RouteLocationRaw
  /** The kind the list was filtered to when the form was opened; a new partner starts as that kind. */
  initialKind?: FinancePartnerKind | null
}>()
const emit = defineEmits<{ saved: [partner: FinancePartner] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const canManage = computed(() => can('finance.partners.manage'))

const formError = ref<unknown>(null)
const errorMessage = computed(() => formError.value ? saveErrorMessage(formError.value, t('errors.generic'), t('errors.saveUncertain')) : undefined)
const nameError = ref<string>()
function fieldError(field: string) {
  if (field === 'name' && nameError.value) return nameError.value
  return formError.value instanceof ApiError && formError.value.field === field ? formError.value.message : undefined
}

const name = ref('')
const isCompany = ref(true)
const customer = ref(false)
const vendor = ref(false)
const vat = ref('')
const companyRegistry = ref('')
const street = ref('')
const city = ref('')
const countryId = ref<number | null>(null)
const stateId = ref<number | null>(null)
watch(name, () => { nameError.value = undefined })

const countrySearch = ref('')
const countriesQuery = useFinanceCountries(refDebounced(countrySearch, 250))
const statesQuery = useFinanceStates(countryId)
const countryOptions = computed(() => {
  const options = new Map<number, string>()
  for (const country of countriesQuery.data.value?.items ?? []) options.set(country.id, country.name)
  if (props.partner?.country) options.set(props.partner.country.id, props.partner.country.name)
  return [{ value: 'none', label: t('finance.partners.form.none') }, ...[...options].map(([value, label]) => ({ value: String(value), label }))]
})
const stateOptions = computed(() => {
  const options = new Map<number, string>()
  for (const state of statesQuery.data.value?.items ?? []) options.set(state.id, state.name)
  if (props.partner?.state && countryId.value === props.partner.country?.id) options.set(props.partner.state.id, props.partner.state.name)
  return [{ value: 'none', label: t('finance.partners.form.none') }, ...[...options].map(([value, label]) => ({ value: String(value), label }))]
})
function idOrNull(value: unknown) { return !value || value === 'none' ? null : Number(value) }
function chooseCountry(value: unknown) { countryId.value = idOrNull(value); stateId.value = null }

const savedState = ref('')
function snapshot() { return JSON.stringify([name.value, isCompany.value, customer.value, vendor.value, vat.value, companyRegistry.value, street.value, city.value, countryId.value, stateId.value]) }
const dirty = computed(() => savedState.value !== snapshot())
watch(() => props.partner, (partner) => {
  name.value = partner?.name ?? ''
  isCompany.value = partner?.is_company ?? true
  customer.value = partner?.customer ?? props.initialKind === 'customer'
  vendor.value = partner?.vendor ?? props.initialKind === 'vendor'
  vat.value = partner?.vat ?? ''
  companyRegistry.value = partner?.company_registry ?? ''
  street.value = partner?.street ?? ''
  city.value = partner?.city ?? ''
  countryId.value = partner?.country?.id ?? null
  stateId.value = partner?.state?.id ?? null
  savedState.value = snapshot()
}, { immediate: true })

const { mutateAsync: create, isPending: creating } = useCreateFinancePartner()
const { mutateAsync: update, isPending: updating } = useUpdateFinancePartner()
const pending = computed(() => creating.value || updating.value)
const disabled = computed(() => !canManage.value || !hydrated.value || pending.value)

let submitting = false
async function submit() {
  if (!canManage.value || !hydrated.value || pending.value || submitting) return
  const trimmed = name.value.trim()
  if (!trimmed) {
    nameError.value = t('finance.partners.form.nameRequired')
    await nextTick()
    document.getElementById('finance-partner-name')?.focus()
    return
  }
  submitting = true
  const body = {
    name: trimmed,
    is_company: isCompany.value,
    customer: customer.value,
    vendor: vendor.value,
    vat: vat.value.trim(),
    company_registry: companyRegistry.value.trim(),
    street: street.value.trim(),
    city: city.value.trim(),
    state_id: stateId.value,
  }
  try {
    // A new partner without a country takes the company's, so the key is only sent once the user chose one.
    const saved = props.partner
      ? await update({ id: props.partner.id, patch: { ...body, country_id: countryId.value } })
      : await create({ ...body, ...(countryId.value ? { country_id: countryId.value } : {}) })
    savedState.value = snapshot()
    formError.value = null
    emit('saved', saved)
  } catch (error) {
    formError.value = error
  } finally { submitting = false }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm :state="{ name, vat }" class="webvue-form" method="post" :loading-auto="false" novalidate @submit="submit">
    <UAlert v-if="formError" role="alert" color="error" variant="subtle" :title="t('finance.partners.form.saveError')" :description="errorMessage" />
    <SharedFormSection panel :title="t('finance.partners.form.general')" :description="t('finance.partners.form.generalHint')">
      <div class="webvue-form-grid">
        <UFormField :label="t('finance.partners.form.name')" name="finance-partner-name" required :error="fieldError('name')">
          <UInput id="finance-partner-name" v-model="name" class="w-full" :disabled="disabled" required />
        </UFormField>
        <UFormField :label="t('finance.partners.form.kinds')" name="finance-partner-kinds">
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
            <UCheckbox id="finance-partner-customer" v-model="customer" :label="t('finance.partners.kind.customer')" :disabled="disabled" />
            <UCheckbox id="finance-partner-vendor" v-model="vendor" :label="t('finance.partners.kind.vendor')" :disabled="disabled" />
            <UCheckbox id="finance-partner-company" v-model="isCompany" :label="t('finance.partners.form.isCompany')" :disabled="disabled" />
          </div>
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('finance.partners.form.tax')" :description="t('finance.partners.form.taxHint')">
      <div class="webvue-form-grid">
        <UFormField :label="t('finance.partners.form.vat')" name="finance-partner-vat" :error="fieldError('vat')">
          <UInput id="finance-partner-vat" v-model="vat" dir="ltr" class="w-full" :disabled="disabled" inputmode="numeric" />
        </UFormField>
        <UFormField :label="t('finance.partners.form.companyRegistry')" name="finance-partner-registry" :error="fieldError('company_registry')">
          <UInput id="finance-partner-registry" v-model="companyRegistry" dir="ltr" class="w-full" :disabled="disabled" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('finance.partners.form.address')">
      <div class="webvue-form-grid">
        <UFormField :label="t('finance.partners.form.street')" name="finance-partner-street" :error="fieldError('street')">
          <UInput id="finance-partner-street" v-model="street" class="w-full" :disabled="disabled" />
        </UFormField>
        <UFormField :label="t('finance.partners.form.city')" name="finance-partner-city" :error="fieldError('city')">
          <UInput id="finance-partner-city" v-model="city" class="w-full" :disabled="disabled" />
        </UFormField>
        <UFormField :label="t('finance.partners.form.country')" name="finance-partner-country-search" class="min-w-0" :error="fieldError('country_id')">
          <div class="grid gap-2">
            <UInput id="finance-partner-country-search" v-model="countrySearch" class="w-full" :disabled="disabled" :aria-label="t('finance.partners.form.countrySearch')" :placeholder="t('finance.partners.form.countrySearch')" icon="i-lucide-search" />
            <UAlert v-if="countriesQuery.error.value" role="alert" color="error" variant="subtle" :title="t('finance.partners.form.countriesError')">
              <template #actions><UButton type="button" color="neutral" variant="outline" size="sm" :disabled="disabled" :label="t('finance.partners.form.retry')" @click="countriesQuery.refetch()" /></template>
            </UAlert>
            <USelect id="finance-partner-country" class="w-full" :model-value="countryId ? String(countryId) : 'none'" :items="countryOptions" :disabled="disabled" @update:model-value="chooseCountry" />
          </div>
        </UFormField>
        <UFormField :label="t('finance.partners.form.state')" name="finance-partner-state" :error="fieldError('state_id')">
          <USelect id="finance-partner-state" class="w-full" :model-value="stateId ? String(stateId) : 'none'" :items="stateOptions" :disabled="disabled || !countryId" @update:model-value="stateId = idOrNull($event)" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <span class="me-auto text-xs text-muted">{{ t('finance.partners.form.hint') }}</span>
      <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
      <UButton type="submit" color="primary" :disabled="disabled" :loading="pending" :label="t(props.partner ? 'app.saveChanges' : 'app.create')" />
    </SharedFormActions>
  </UForm>
</template>
