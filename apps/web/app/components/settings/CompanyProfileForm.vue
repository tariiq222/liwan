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
import { companyPatch, profileToForm, SECTION_FIELDS, sectionExtensions, type CompanyForm, type CompanySection } from '@/utils/companyProfile'
import { saveErrorMessage } from '@/utils/formFeedback'

// One card of the company page (the profile itself, the national address or the contact details). The three cards share
// this form, so they save and guard drafts alike; the company header card sits once above them.
const props = defineProps<{ profile: CompanyProfile; section: CompanySection }>()

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
const fieldErrors = ref<Record<string, string>>({})
const logoError = ref('')
const logoInput = ref<{ reset: () => void } | null>(null)

// The fields installed applications add to this card, in the server's order.
const extensions = computed(() => sectionExtensions(props.profile, props.section))
// The fields this card owns, copied out of a profile.
function read(profile: CompanyProfile): CompanyForm {
  const form = profileToForm(profile)
  const names = [...SECTION_FIELDS[props.section], ...sectionExtensions(profile, props.section).map(extension => extension.name)]
  return Object.fromEntries(names.map(name => [name, form[name] ?? null]))
}

const { draft, state, save, revert, reload } = useSettingsForm<CompanyProfile, CompanyForm>({
  source: () => props.profile,
  read,
  save: async (values, latest) => {
    fieldErrors.value = {}
    try {
      if (props.section === 'profile' && !String(values.name ?? '').trim()) {
        throw new ApiError(422, 'invalid', t('settings.company.errors.nameRequired'), 'name')
      }
      const patch = companyPatch(props.section, sectionExtensions(latest, props.section), read(latest), values)
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

function setField(field: string, value: string | number | null | undefined) {
  draft.value[field] = value ?? null
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
      <UFormField orientation="horizontal" name="vat" :label="t('settings.company.vat')" :description="t('settings.company.vatHint')" :error="fieldErrors.vat">
        <UInput id="company-vat" v-model="fields.vat.value" class="w-full" dir="ltr" inputmode="numeric" data-testid="company-vat" :disabled="locked" />
      </UFormField>
    </template>

    <template v-else-if="section === 'address'">
      <UFormField orientation="horizontal" name="country_id" :label="t('settings.company.country')" :description="t('settings.company.countryFixed')">
        <UInput id="company-country" :model-value="country?.name ?? ''" class="w-full" data-testid="company-country" readonly disabled />
      </UFormField>
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

    <CompanyExtensionField v-for="extension in extensions" :key="extension.name" :extension="extension" :model-value="draft[extension.name] ?? null" :error="fieldErrors[extension.name]" :disabled="locked" @update:model-value="setField(extension.name, $event)" />
  </SharedSettingsCard>
</template>
