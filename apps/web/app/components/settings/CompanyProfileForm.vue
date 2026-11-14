<script setup lang="ts">
import type { CompanyProfile } from '@liwan/contracts'
import CompanyExtensionField from '@/components/settings/CompanyExtensionField.vue'
import { ApiError } from '@/composables/useApi'
import {
  useCompanyProfile,
  useCompanyStates,
  useUpdateCompany,
  useUploadCompanyLogo,
} from '@/composables/useCompanyProfile'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { companyPatch, profileToForm, SECTION_FIELDS, sectionExtensions, vatNumberMissing, type CompanyForm, type CompanySection } from '@/utils/companyProfile'
import { saveErrorMessage } from '@/utils/formFeedback'

// One card of the company page (the profile itself, the national address or the contact details). The three cards share
// this form, so they save and guard drafts alike; the company header card sits once above them. `taxOwnsVat` is true while
// the establishment tax card exists: it owns the VAT registration switch, so this card keeps only the number.
const props = defineProps<{ profile: CompanyProfile; section: CompanySection; taxOwnsVat?: boolean }>()

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const LOGO_TYPES = ['image/png', 'image/jpeg']

const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const { can } = useAccess()
const { refetch } = useCompanyProfile()
const update = useUpdateCompany()
const uploadLogo = useUploadCompanyLogo()

const editable = computed(() => can('settings.company.manage'))
// The server owns who may change the establishment's VAT registration: only the root company's session holding the VAT
// right. A branch session reads the establishment's answer here and cannot change it, whatever role it holds.
const vatEditable = computed(() => props.profile.vat_registration_editable)
// The profile says whether this session's company is the root. A branch keeps its own VAT number; only the root's is the
// establishment's registration number.
const branchSession = computed(() => !props.profile.is_root_company)
// Why the registration switch is read-only, from the real fact: a branch changes the registration from the main company;
// a root session without the VAT right names the missing permission; a root session that holds the right and is still
// refused is in a read-only state (seat, branch or subscription), which gets no reason of its own here.
const vatReason = computed(() => {
  if (branchSession.value) return t('settings.company.tax.changedFromRoot')
  return can('settings.company.vat.manage') ? undefined : t('settings.company.vatManageHint')
})
const fieldErrors = ref<Record<string, string>>({})
const logoError = ref('')
const logoInput = ref<{ reset: () => void } | null>(null)

// The fields installed applications add to this card, in the server's order.
const extensions = computed(() => sectionExtensions(props.profile, props.section))
// Fields another card of this page owns: while the establishment tax card is on screen it saves the registration, so this
// card never sends or compares it — otherwise that save looks like a change made elsewhere and locks this card.
const ownedElsewhere = computed(() => (props.taxOwnsVat ? ['vat_registered'] : []))
// The fields this card's draft holds, copied out of a profile. The shape never depends on whether another card owns a
// field: the tax query can resolve after the profile query, and a draft that lost a field on that switch would read as
// an unsaved edit. `compare` below is what keeps the owned field out of the dirty state and the conflict check.
function read(profile: CompanyProfile): CompanyForm {
  const form = profileToForm(profile)
  const names = [...SECTION_FIELDS[props.section], ...sectionExtensions(profile, props.section).map(extension => extension.name)]
  return Object.fromEntries(names.map(name => [name, form[name] ?? null]))
}
// The draft fields this card decides: the fields another card owns are held in the draft but never compared.
function compare(draft: CompanyForm): CompanyForm {
  const owned = ownedElsewhere.value
  return Object.fromEntries(Object.entries(draft).filter(([name]) => !owned.includes(name)))
}

const { draft, state, save, revert, reload } = useSettingsForm<CompanyProfile, CompanyForm>({
  source: () => props.profile,
  read,
  compare,
  save: async (values, latest) => {
    fieldErrors.value = {}
    try {
      if (props.section === 'profile' && !String(values.name ?? '').trim()) {
        throw new ApiError(422, 'invalid', t('settings.company.errors.nameRequired'), 'name')
      }
      const patch = companyPatch(props.section, sectionExtensions(latest, props.section), read(latest), values, ownedElsewhere.value)
      // Registering for VAT needs its number on the root company: the server refuses the body anyway, the field says so
      // first. Only a save that changes the switch or the number is held to it, and a branch's own number is not the
      // establishment's registration number, so the rule does not reach it.
      const registered = props.taxOwnsVat ? registrationOn.value : Boolean(values.vat_registered)
      if (props.section === 'profile' && !branchSession.value && vatNumberMissing(patch, { ...values, vat_registered: registered })) {
        throw new ApiError(422, 'invalid_vat', t('settings.company.errors.vatRequired'), 'vat')
      }
      if (!Object.keys(patch).length) return latest
      const next = await update.mutateAsync(patch)
      toast.add({ title: t('settings.company.saved'), color: 'success' })
      return next
    } catch (e) {
      // An error that names a field also shows under it.
      if (e instanceof ApiError && e.field) fieldErrors.value = { [e.field]: saveErrorMessage(e, t('errors.generic'), t('errors.saveUncertain')) }
      throw e
    }
  },
  reload: async () => {
    const result = await refetch()
    if (result.isError) throw result.error
    return result.data ?? props.profile
  },
})

const locked = computed(() => !hydrated.value || !editable.value || state.value.saving || state.value.reloading)
const vatLocked = computed(() => locked.value || !vatEditable.value)
// The number is the registration number only in the root company, where the same right owns it. A branch keeps its own
// number, and the server accepts that write there, so the branch session's read-only switch does not reach the field.
const vatNumberLocked = computed(() => locked.value || (!vatEditable.value && !branchSession.value))
const heading = computed(() => ({
  profile: { title: t('settings.company.identity.title') },
  address: { title: t('settings.company.address.title'), description: t('settings.company.address.hint') },
  contact: { title: t('settings.company.contact.title') },
})[props.section])

// The country is set at provisioning: shown read-only, and the region list follows it.
const country = computed(() => props.profile.address.country)
const countryId = computed(() => country.value?.id ?? null)
const { data: states } = useCompanyStates(countryId)
const stateItems = computed(() => (states.value?.items ?? []).map(item => ({ value: item.id, label: item.name })))

function text(field: string) {
  return computed({
    get: () => (draft.value[field] as string | null) ?? '',
    set: (value: string) => { draft.value[field] = value },
  })
}
const fields = {
  name: text('name'), report_header: text('report_header'), company_registry: text('company_registry'), vat: text('vat'),
  city: text('city'), street: text('street'), street2: text('street2'), zip: text('zip'),
  email: text('email'), phone: text('phone'), website: text('website'),
}

// The number belongs to the company. A root can save it before registering from the tax card.
const vatRegistered = computed({
  get: () => Boolean(draft.value.vat_registered),
  set: (value: boolean) => { draft.value.vat_registered = value },
})
// The registration comes from the saved profile when the tax card owns it.
const registrationOn = computed(() => (props.taxOwnsVat ? props.profile.vat_registered : vatRegistered.value))
const showVatNumber = computed(() => registrationOn.value || (props.taxOwnsVat && !branchSession.value))

function setField(field: string, value: string | number | null | undefined) {
  draft.value[field] = value ?? null
}

// An installed application's field is text or a selection: never the VAT registration switch's boolean.
function extensionValue(name: string): string | number | null {
  const value = draft.value[name]
  return typeof value === 'boolean' ? null : value ?? null
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function onLogo(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  logoError.value = ''
  if (!file) return
  if (!LOGO_TYPES.includes(file.type)) logoError.value = t('settings.company.errors.logoFormat')
  else if (file.size > MAX_LOGO_BYTES) logoError.value = t('settings.company.errors.logoSize')
  else {
    try {
      await uploadLogo.mutateAsync({ data: await readFile(file) })
      toast.add({ title: t('settings.company.logoSaved'), color: 'success' })
    } catch (e) {
      logoError.value = e instanceof ApiError ? e.message : t('settings.company.errors.logoRead')
    }
  }
  logoInput.value?.reset()
}
</script>

<template>
  <SharedSettingsCard :id="section" v-bind="state" :title="heading.title" :description="heading.description" :can-edit="editable" :data-testid="`company-${section}`" @save="save" @revert="revert" @reload="reload">
    <template v-if="section === 'profile'">
      <UFormField orientation="horizontal" name="logo" :label="t('settings.company.logo')" :description="t('settings.company.logoHint')" :error="logoError || undefined">
        <SharedFileField ref="logoInput" accept="image/png,image/jpeg" :label="t('settings.company.logoChoose')" :show-file-name="false" data-testid="company-logo" :disabled="locked || uploadLogo.isPending.value" @change="onLogo" />
      </UFormField>
      <UFormField orientation="horizontal" name="name" :label="t('settings.company.name')" required :error="fieldErrors.name">
        <UInput id="company-name" v-model="fields.name.value" class="w-full" data-testid="company-name" :disabled="locked" />
      </UFormField>
      <UFormField orientation="horizontal" name="report_header" :label="t('settings.company.tagline')" :description="t('settings.company.taglineHint')" :error="fieldErrors.report_header">
        <UInput id="company-tagline" v-model="fields.report_header.value" class="w-full" data-testid="company-tagline" :disabled="locked" />
      </UFormField>
      <UFormField orientation="horizontal" name="company_registry" :label="t('settings.company.registry')" :error="fieldErrors.company_registry">
        <UInput id="company-registry" v-model="fields.company_registry.value" class="w-full" dir="ltr" inputmode="numeric" data-testid="company-registry" :disabled="locked" />
      </UFormField>
      <SharedSettingRow v-if="!taxOwnsVat" name="vat_registered" :label="t('settings.company.vatRegistered')" :description="t('settings.company.vatRegisteredHint')" :disabled-reason="vatEditable ? undefined : vatReason">
        <USwitch id="company-vat-registered" v-model="vatRegistered" :aria-label="t('settings.company.vatRegistered')" data-testid="company-vat-registered" :disabled="vatLocked" />
      </SharedSettingRow>
      <UFormField v-if="showVatNumber" orientation="horizontal" name="vat" :label="t('settings.company.vat')" :description="t('settings.company.vatHint')" :required="registrationOn" :error="fieldErrors.vat">
        <UInput id="company-vat" v-model="fields.vat.value" class="w-full" dir="ltr" inputmode="numeric" data-testid="company-vat" :disabled="vatNumberLocked" />
      </UFormField>
    </template>

    <template v-else-if="section === 'address'">
      <SharedSettingRow name="country_id" :label="t('settings.company.country')" :description="t('settings.company.countryFixed')">
        <UInput id="company-country" :model-value="country?.name ?? ''" class="w-full" data-testid="company-country" readonly disabled />
      </SharedSettingRow>
      <UFormField orientation="horizontal" name="state_id" :label="t('settings.company.state')" :error="fieldErrors.state_id">
        <USelectMenu id="company-state" :model-value="(draft.state_id as number | null) ?? undefined" class="w-full" value-key="value" :items="stateItems" data-testid="company-state" :disabled="locked || !countryId" @update:model-value="setField('state_id', $event as number | undefined)" />
      </UFormField>
      <UFormField orientation="horizontal" name="city" :label="t('settings.company.city')" :error="fieldErrors.city">
        <UInput id="company-city" v-model="fields.city.value" class="w-full" data-testid="company-city" :disabled="locked" />
      </UFormField>
      <UFormField orientation="horizontal" name="street2" :label="t('settings.company.district')" :error="fieldErrors.street2">
        <UInput id="company-district" v-model="fields.street2.value" class="w-full" data-testid="company-district" :disabled="locked" />
      </UFormField>
      <UFormField orientation="horizontal" name="street" :label="t('settings.company.street')" :error="fieldErrors.street">
        <UInput id="company-street" v-model="fields.street.value" class="w-full" data-testid="company-street" :disabled="locked" />
      </UFormField>
      <UFormField orientation="horizontal" name="zip" :label="t('settings.company.zip')" :error="fieldErrors.zip">
        <UInput id="company-zip" v-model="fields.zip.value" class="w-full" dir="ltr" inputmode="numeric" data-testid="company-zip" :disabled="locked" />
      </UFormField>
    </template>

    <template v-else>
      <UFormField orientation="horizontal" name="email" :label="t('settings.company.email')" :error="fieldErrors.email">
        <UInput id="company-email" v-model="fields.email.value" type="email" class="w-full" dir="ltr" data-testid="company-email" :disabled="locked" />
      </UFormField>
      <UFormField orientation="horizontal" name="phone" :label="t('settings.company.phone')" :error="fieldErrors.phone">
        <UInput id="company-phone" v-model="fields.phone.value" type="tel" class="w-full" dir="ltr" data-testid="company-phone" :disabled="locked" />
      </UFormField>
      <UFormField orientation="horizontal" name="website" :label="t('settings.company.website')" :error="fieldErrors.website">
        <UInput id="company-website" v-model="fields.website.value" type="url" class="w-full" dir="ltr" data-testid="company-website" :disabled="locked" />
      </UFormField>
    </template>

    <CompanyExtensionField v-for="extension in extensions" :key="extension.name" :extension="extension" :model-value="extensionValue(extension.name)" :error="fieldErrors[extension.name]" :disabled="locked" @update:model-value="setField(extension.name, $event)" />
  </SharedSettingsCard>
</template>
