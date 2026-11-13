<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { Customer, CustomerCandidate, CustomerSettings } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { refDebounced } from '@vueuse/core'
import { saveErrorMessage } from '@/utils/formFeedback'
import { customerConflictCandidates, customerFormField, customerPropertyError } from '@/composables/customers/customerErrors'
import { shouldResetCustomerDraft, topAlertVisible, useCustomerFormFields, useShownCustomerFields } from '@/composables/customers/customerFormState'
import { emptyCustomerFields, parentPickerOffered, partyKindForm } from '@/composables/customers/customerPartyKind'
import { customerCreateBody, customerPatchBody, type CustomerDraft } from '@/composables/customers/customerPayload'
import { useCustomerCompanies } from '@/composables/customers/useCustomerCompanies'
import { useCreateCustomer, useUpdateCustomer } from '@/composables/customers/useCustomers'
import CustomerConflictStep from './CustomerConflictStep.vue'

// The create and edit form of a customer. The tenant's party kinds decide whether the person/company choice is offered;
// the custom fields come from the settings definition (a new customer) or from the customer itself (an edit).
const props = defineProps<{ customer?: Customer | null; settings: CustomerSettings; backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [customer: Customer]; open: [id: number] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const canManage = computed(() => can('customers.manage'))

const parentId = ref<number | null>(null)
const kind = computed(() => partyKindForm(props.settings.party_kinds, parentId.value !== null))
// What the customer is: the user's choice, else what the party kinds make it, else what an existing customer already is.
const effectiveIsCompany = computed(() => (kind.value.canChoose ? isCompany.value : props.customer ? props.customer.is_company : kind.value.isCompany))
const fields = useShownCustomerFields(() => props.customer?.properties ?? emptyCustomerFields(props.settings.fields), () => props.customer?.id, () => dirty.value)

const name = ref('')
const phone = ref('')
const email = ref('')
const isCompany = ref(false)
const companySearch = ref('')
const companyTerm = refDebounced(companySearch, 250)
const companies = useCustomerCompanies(companyTerm)
const anyCompany = useCustomerCompanies('', 1)
const { changed: customChanged, dirty: customDirty, errors: customErrors, change: changeCustomFields } = useCustomerFormFields(() => fields.value)
const nameError = ref<string>()
watch(name, () => { nameError.value = undefined })

const savedState = ref('')
const snapshot = () => JSON.stringify([name.value, phone.value, email.value, isCompany.value, parentId.value])
const dirty = computed(() => savedState.value !== snapshot() || customDirty.value)
// A refetch hands the form the same customer again: it must not wipe what the user typed, so the draft is replaced only
// for another customer or while nothing was typed.
let initialised = false
watch(() => props.customer, (customer, previous) => {
  if (initialised && !shouldResetCustomerDraft(previous, customer, dirty.value)) return
  initialised = true
  name.value = customer?.name ?? ''
  phone.value = customer?.phone ?? ''
  email.value = customer?.email ?? ''
  parentId.value = customer?.parent?.id ?? null
  isCompany.value = customer ? customer.is_company : kind.value.isCompany
  savedState.value = snapshot()
}, { immediate: true })

const formError = ref<unknown>(null)
const conflict = ref<CustomerCandidate[] | null>(null)
const errorMessage = computed(() => formError.value ? saveErrorMessage(formError.value, t('errors.generic'), t('errors.saveUncertain')) : undefined)
const phoneError = computed(() => (customerFormField(formError.value) === 'phone' ? t('customers.form.invalidPhone') : undefined))
const parentError = computed(() => (customerFormField(formError.value) === 'parent_id' ? t('customers.form.parentRefused') : undefined))
const kindError = computed(() => (customerFormField(formError.value) === 'is_company' ? t('customers.form.partyKindNotAllowed') : undefined))
// A refusal that belongs to a field on the form is shown at that field; any other one stays at the top of the form.
const alertVisible = computed(() => topAlertVisible(formError.value, { kind: kind.value.canChoose, parent: parentOffered.value }, Object.keys(customErrors.value).length > 0))

const { mutateAsync: create, isPending: creating } = useCreateCustomer()
const { mutateAsync: update, isPending: updating } = useUpdateCustomer()
const pending = computed(() => creating.value || updating.value)
const disabled = computed(() => !canManage.value || !hydrated.value || pending.value)

const draftOf = (): CustomerDraft => ({
  name: name.value,
  phone: phone.value,
  email: email.value,
  isCompany: effectiveIsCompany.value,
  canChoosePartyKind: kind.value.canChoose,
  parentId: parentId.value,
  changedFields: customChanged.value,
})

function showFailure(error: unknown) {
  conflict.value = customerConflictCandidates(error)
  formError.value = conflict.value ? null : error
  const property = customerPropertyError(error)
  if (property && error instanceof ApiError) customErrors.value = { [property.key]: error.message }
}

// An edit that changes nothing saves nothing and returns the customer as it is.
async function edit(customer: Customer) {
  const patch = customerPatchBody(customer, draftOf())
  return Object.keys(patch).length ? update({ id: customer.id, patch }) : customer
}

const parentOffered = computed(() => parentPickerOffered({
  kinds: props.settings.party_kinds,
  isCompany: effectiveIsCompany.value,
  creating: !props.customer,
  companiesExist: (anyCompany.data.value?.total ?? 0) > 0,
  parentChosen: parentId.value !== null,
}))
const NO_PARENT = 'none'
// The chosen parent stays on the list while a search narrows it away.
const parentItems = computed(() => {
  const found = new Map<number, string>()
  if (props.customer?.parent) found.set(props.customer.parent.id, props.customer.parent.name)
  for (const company of companies.data.value?.items ?? []) if (company.id !== props.customer?.id) found.set(company.id, company.name)
  return [{ value: NO_PARENT, label: t('customers.form.noParent') }, ...[...found].map(([value, label]) => ({ value: String(value), label }))]
})
function chooseParent(value: unknown) { parentId.value = !value || value === NO_PARENT ? null : Number(value) }
// A company has no parent, so choosing "company" lets go of it.
watch(effectiveIsCompany, (company) => { if (company) parentId.value = null })

let submitting = false
async function submit(createNew = false) {
  if (!canManage.value || !hydrated.value || pending.value || submitting) return
  if (!name.value.trim()) {
    nameError.value = t('customers.form.nameRequired')
    await nextTick()
    document.getElementById('customer-name')?.focus()
    return
  }
  submitting = true
  formError.value = null
  conflict.value = null
  customErrors.value = {}
  try {
    const saved = props.customer ? await edit(props.customer) : await create(customerCreateBody(draftOf(), createNew))
    savedState.value = snapshot()
    customDirty.value = false
    emit('saved', saved)
  } catch (error) {
    showFailure(error)
  } finally { submitting = false }
}
function openExisting(id: number) {
  // The typed draft is given up on purpose: the chosen customer already exists.
  savedState.value = snapshot()
  customDirty.value = false
  emit('open', id)
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm :state="{ name, phone }" class="liwan-form" method="post" :loading-auto="false" novalidate @submit="submit(false)">
    <UAlert v-if="alertVisible" role="alert" color="error" variant="subtle" :title="t('customers.form.saveError')" :description="errorMessage" />
    <CustomerConflictStep v-if="conflict" :candidates="conflict" :pending="pending" @open="openExisting" @create-new="submit(true)" @cancel="conflict = null" />
    <SharedFormSection panel :title="t('customers.form.identity')" :description="t('customers.form.identityHint')">
      <div class="liwan-auto-grid [--liwan-auto-grid-min:20rem]">
        <UFormField :label="t('customers.form.name')" name="customer-name" required :error="nameError">
          <UInput id="customer-name" v-model="name" class="w-full" :disabled="disabled" required data-testid="customer-name" />
        </UFormField>
        <UFormField :label="t('customers.form.phone')" name="customer-phone" :error="phoneError" :help="settings.phone_country ? t('customers.form.phoneHint', { country: settings.phone_country.name }) : undefined">
          <UInput id="customer-phone" v-model="phone" dir="ltr" inputmode="tel" class="w-full" :disabled="disabled" placeholder="+966500000000" data-testid="customer-phone" />
        </UFormField>
        <UFormField :label="t('customers.form.email')" name="customer-email">
          <UInput id="customer-email" v-model="email" dir="ltr" type="email" class="w-full" :disabled="disabled" data-testid="customer-email" />
        </UFormField>
        <UFormField v-if="parentOffered" :label="t('customers.form.parent')" name="customer-parent" :error="parentError" :help="settings.party_kinds === 'companies' && !customer ? t('customers.form.parentCompaniesHint') : t('customers.form.parentHint')">
          <USelectMenu :model-value="parentId === null ? NO_PARENT : String(parentId)" v-model:search-term="companySearch" value-key="value" :items="parentItems" ignore-filter :search-input="{ placeholder: t('customers.form.parentSearch') }" :loading="companies.isFetching.value" :aria-label="t('customers.form.parent')" class="w-full" :disabled="disabled" data-testid="customer-parent" @update:model-value="chooseParent" />
        </UFormField>
        <UFormField v-if="kind.canChoose" :label="t('customers.form.kind')" name="customer-kind" :error="kindError">
          <URadioGroup v-model="isCompany" :items="[{ value: false, label: t('customers.kind.person') }, { value: true, label: t('customers.kind.company') }]" orientation="horizontal" :disabled="disabled" data-testid="customer-kind" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection v-if="fields.length" panel :title="t('customers.form.fields')" :description="t('customers.form.fieldsHint')">
      <dl class="divide-y divide-default">
        <SharedCustomFieldRows v-model:dirty="customDirty" :fields="fields" editable :disabled="disabled" :errors="customErrors" @change="changeCustomFields" />
      </dl>
    </SharedFormSection>
    <SharedFormActions>
      <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
      <UButton type="submit" color="primary" :disabled="disabled" :loading="pending" :label="t(props.customer ? 'app.saveChanges' : 'app.create')" data-testid="customer-submit" />
    </SharedFormActions>
  </UForm>
</template>
