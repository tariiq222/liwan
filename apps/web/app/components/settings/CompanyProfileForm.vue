<script setup lang="ts">
import type { CompanyProfilePatch } from '@webvue/contracts'
import CompanyExtensionField from '@/components/settings/CompanyExtensionField.vue'
import { ApiError } from '@/composables/useApi'
import {
  useCompanyProfile,
  useCompanyStates,
  useUpdateCompany,
  useUploadCompanyLogo,
} from '@/composables/useCompanyProfile'
import { companyPatch, profileToForm, sectionExtensions, type CompanyForm, type CompanySection } from '@/utils/companyProfile'
import { saveErrorMessage } from '@/utils/formFeedback'

// One card of the company page (the profile itself, the national address or the contact details). The three cards share
// this form, so they save and guard drafts alike; the company header card sits once above them.
const props = defineProps<{ section: CompanySection }>()

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const LOGO_TYPES = ['image/png', 'image/jpeg']

const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const { can } = useAccess()
const { data: profile, isLoading, error, refetch } = useCompanyProfile()
const update = useUpdateCompany()
const uploadLogo = useUploadCompanyLogo()

const editable = computed(() => can('settings.company.manage'))
const draft = reactive<CompanyForm>({} as CompanyForm)
const saved = shallowRef<CompanyForm | null>(null)
const fieldErrors = ref<Record<string, string>>({})
const formError = ref('')
const logoError = ref('')
const logoInput = ref<{ reset: () => void } | null>(null)

function load(next: CompanyForm) {
  saved.value = next
  Object.assign(draft, next)
}
// The fields installed applications add to this page, in the server's order.
const extensions = computed(() => (profile.value ? sectionExtensions(profile.value, props.section) : []))
const patch = computed<CompanyProfilePatch>(() => (saved.value ? companyPatch(props.section, extensions.value, saved.value, draft) : {}))
const dirty = computed(() => Object.keys(patch.value).length > 0)
watch(profile, (value) => {
  if (value && !dirty.value) load(profileToForm(value))
}, { immediate: true })

const busy = computed(() => update.isPending.value || uploadLogo.isPending.value)
// The country is set at provisioning: shown read-only, and the region list follows it.
const country = computed(() => profile.value?.address.country ?? null)
const countryId = computed(() => country.value?.id ?? null)
const { data: states } = useCompanyStates(countryId)

const stateItems = computed(() => (states.value?.items ?? []).map(state => ({ value: state.id, label: state.name })))

function text(field: string) {
  return computed({
    get: () => (draft[field] as string | null) ?? '',
    set: (value: string) => { draft[field] = value },
  })
}
const fields = {
  name: text('name'), report_header: text('report_header'), company_registry: text('company_registry'), vat: text('vat'),
  city: text('city'), street: text('street'), street2: text('street2'), zip: text('zip'),
  email: text('email'), phone: text('phone'), website: text('website'),
}

function setField(field: string, value: string | number | null | undefined) {
  draft[field] = value ?? null
}

function cancel() {
  if (saved.value) Object.assign(draft, saved.value)
  fieldErrors.value = {}
  formError.value = ''
}

async function save() {
  fieldErrors.value = {}
  formError.value = ''
  if (props.section === 'profile' && !String(draft.name ?? '').trim()) {
    fieldErrors.value = { name: t('settings.company.errors.nameRequired') }
    return
  }
  try {
    const next = await update.mutateAsync(patch.value)
    load(profileToForm(next))
    toast.add({ title: t('settings.company.saved'), color: 'success' })
  } catch (e) {
    // The draft stays after a rejected save; an error that names a field shows under it.
    const message = saveErrorMessage(e, t('settings.company.errors.generic'), t('errors.saveUncertain'))
    if (e instanceof ApiError && e.field) fieldErrors.value = { [e.field]: message }
    else formError.value = message
  }
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
  <SharedLoadingSkeleton v-if="!hydrated || isLoading" variant="rows" :count="4" />
  <UAlert v-else-if="error" data-testid="company-load-error" color="error" variant="subtle" :title="t('settings.company.errors.load')">
    <template #actions>
      <UButton type="button" color="neutral" variant="outline" data-testid="company-retry" @click="refetch()">{{ t('settings.company.retry') }}</UButton>
    </template>
  </UAlert>
  <div v-else-if="profile" class="webvue-form" :data-testid="`company-${section}`">
    <form class="webvue-form" novalidate @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <p v-if="!editable" class="text-sm text-muted" data-testid="company-readonly">{{ t('settings.company.readonly') }}</p>

      <template v-if="section === 'profile'">
        <SharedFormSection panel :title="t('settings.company.identity.title')">
          <div class="grid gap-5">
            <UFormField name="logo" :label="t('settings.company.logo')" :help="t('settings.company.logoHint')" :error="logoError || undefined">
              <SharedFileField ref="logoInput" accept="image/png,image/jpeg" :label="t('settings.company.logoChoose')" :show-file-name="false" data-testid="company-logo" :disabled="!hydrated || !editable || busy" @change="onLogo" />
            </UFormField>
            <UFormField name="name" :label="t('settings.company.name')" required :error="fieldErrors.name">
              <UInput id="company-name" v-model="fields.name.value" class="w-full" data-testid="company-name" :disabled="!editable || busy" />
            </UFormField>
            <UFormField name="report_header" :label="t('settings.company.tagline')" :help="t('settings.company.taglineHint')" :error="fieldErrors.report_header">
              <UInput id="company-tagline" v-model="fields.report_header.value" class="w-full" data-testid="company-tagline" :disabled="!editable || busy" />
            </UFormField>
          </div>
        </SharedFormSection>
        <SharedFormSection panel :title="t('settings.company.registration.title')">
          <div class="grid gap-5 sm:grid-cols-2">
            <UFormField name="company_registry" :label="t('settings.company.registry')" :error="fieldErrors.company_registry">
              <UInput id="company-registry" v-model="fields.company_registry.value" class="w-full" dir="ltr" inputmode="numeric" data-testid="company-registry" :disabled="!editable || busy" />
            </UFormField>
            <UFormField name="vat" :label="t('settings.company.vat')" :help="t('settings.company.vatHint')" :error="fieldErrors.vat">
              <UInput id="company-vat" v-model="fields.vat.value" class="w-full" dir="ltr" inputmode="numeric" data-testid="company-vat" :disabled="!editable || busy" />
            </UFormField>
            <CompanyExtensionField v-for="extension in extensions" :key="extension.name" :extension="extension" :model-value="draft[extension.name] ?? null" :error="fieldErrors[extension.name]" :disabled="!editable || busy" @update:model-value="setField(extension.name, $event)" />
          </div>
        </SharedFormSection>
      </template>

      <SharedFormSection v-else-if="section === 'address'" panel :title="t('settings.company.address.title')" :description="t('settings.company.address.hint')">
        <div class="grid gap-5 sm:grid-cols-2">
          <UFormField name="country_id" :label="t('settings.company.country')" :hint="t('settings.company.countryFixed')">
            <UInput id="company-country" :model-value="country?.name ?? ''" class="w-full" data-testid="company-country" readonly disabled />
          </UFormField>
          <UFormField name="state_id" :label="t('settings.company.state')" :error="fieldErrors.state_id">
            <USelectMenu id="company-state" :model-value="(draft.state_id as number | null) ?? undefined" class="w-full" value-key="value" :items="stateItems" data-testid="company-state" :disabled="!editable || busy || !countryId" @update:model-value="setField('state_id', $event as number | undefined)" />
          </UFormField>
          <UFormField name="city" :label="t('settings.company.city')" :error="fieldErrors.city">
            <UInput id="company-city" v-model="fields.city.value" class="w-full" data-testid="company-city" :disabled="!editable || busy" />
          </UFormField>
          <UFormField name="street2" :label="t('settings.company.district')" :error="fieldErrors.street2">
            <UInput id="company-district" v-model="fields.street2.value" class="w-full" data-testid="company-district" :disabled="!editable || busy" />
          </UFormField>
          <UFormField name="street" :label="t('settings.company.street')" :error="fieldErrors.street" class="sm:col-span-2">
            <UInput id="company-street" v-model="fields.street.value" class="w-full" data-testid="company-street" :disabled="!editable || busy" />
          </UFormField>
          <UFormField name="zip" :label="t('settings.company.zip')" :error="fieldErrors.zip">
            <UInput id="company-zip" v-model="fields.zip.value" class="w-full" dir="ltr" inputmode="numeric" data-testid="company-zip" :disabled="!editable || busy" />
          </UFormField>
          <CompanyExtensionField v-for="extension in extensions" :key="extension.name" :extension="extension" :model-value="draft[extension.name] ?? null" :error="fieldErrors[extension.name]" :disabled="!editable || busy" @update:model-value="setField(extension.name, $event)" />
        </div>
      </SharedFormSection>

      <SharedFormSection v-else panel :title="t('settings.company.contact.title')">
        <div class="grid gap-5 sm:grid-cols-2">
          <UFormField name="email" :label="t('settings.company.email')" :error="fieldErrors.email">
            <UInput id="company-email" v-model="fields.email.value" type="email" class="w-full" dir="ltr" data-testid="company-email" :disabled="!editable || busy" />
          </UFormField>
          <UFormField name="phone" :label="t('settings.company.phone')" :error="fieldErrors.phone">
            <UInput id="company-phone" v-model="fields.phone.value" type="tel" class="w-full" dir="ltr" data-testid="company-phone" :disabled="!editable || busy" />
          </UFormField>
          <UFormField name="website" :label="t('settings.company.website')" :error="fieldErrors.website" class="sm:col-span-2">
            <UInput id="company-website" v-model="fields.website.value" type="url" class="w-full" dir="ltr" data-testid="company-website" :disabled="!editable || busy" />
          </UFormField>
        </div>
      </SharedFormSection>

      <UAlert v-if="formError" role="alert" color="error" variant="subtle" :title="formError" data-testid="company-error" />
      <SharedFormActions v-if="editable">
        <UButton type="button" color="neutral" variant="outline" data-testid="company-cancel" :disabled="!dirty || busy" @click="cancel">{{ t('settings.company.cancel') }}</UButton>
        <UButton type="submit" data-testid="company-submit" :disabled="!hydrated || !dirty || busy">{{ update.isPending.value ? t('app.saving') : t('settings.company.save') }}</UButton>
      </SharedFormActions>
    </form>
  </div>
</template>
