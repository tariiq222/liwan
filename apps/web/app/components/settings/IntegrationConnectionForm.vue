<script setup lang="ts">
import type { IntegrationConnection, IntegrationConnectionCreate, IntegrationProvider } from '@liwan/contracts'
import { useCreateIntegrationConnection } from '@/composables/useIntegrationConnections'
import { ApiError } from '@/composables/useApi'
import { integrationAttributeLabel, integrationErrorText, integrationSecretLabel, integrationServerMessage } from '@/utils/integrationLabels'
import { typedValues } from '@/utils/integrationConnections'
import { hasIntegrationGuide } from '@/utils/integrationGuide'

// The form of the create panel: the account id, an optional name, the provider's own fields and one write-only input
// per secret the customer types. The server checks the keys with the provider before it stores anything, so a refusal
// leaves the typed values in place for another try. Nothing a secret input holds is kept after the form closes.
const props = defineProps<{ provider: IntegrationProvider; backTo: string }>()
const emit = defineEmits<{ created: [connection: IntegrationConnection] }>()
const { t, te } = useI18n()
const hydrated = useHydrated()
const create = useCreateIntegrationConnection()
const idBase = useId()

// The only provider field the create body carries today.
const attributeNames = computed(() => props.provider.attributes.filter(name => name === 'app_id'))
// The fields this form draws an input for: a server error on any other field has no place next to one.
const renderedFields = computed(() => new Set(['external_id', 'label', ...attributeNames.value, ...props.provider.secrets]))

const externalId = ref('')
const label = ref('')
const attributes = reactive<Record<string, string>>({})
const secrets = reactive<Record<string, string>>({})
const fieldErrors = ref<Record<string, string>>({})
const failure = ref('')
// The same limits as the server and the contract: a key is 8 to 1024 characters.
const SECRET_MIN = 8
const SECRET_MAX = 1024
const secretLengthOk = (value: string) => value.trim().length >= SECRET_MIN && value.trim().length <= SECRET_MAX
const saved = ref(false)
const dirty = computed(() => !saved.value && Boolean(externalId.value.trim() || label.value.trim() || Object.values(attributes).some(value => value.trim()) || Object.values(secrets).some(value => value.trim())))
const busy = computed(() => !hydrated.value || create.isPending.value)
onBeforeUnmount(() => { for (const name of Object.keys(secrets)) secrets[name] = '' })

/** The input a refusal names (`external_id`, `app_id`, `secrets.<name>`), else null. */
function failedField(error: unknown): string | null {
  const field = error instanceof ApiError ? error.field : undefined
  return field ? (field.startsWith('secrets.') ? field.slice('secrets.'.length) : field) : null
}

function missingField(): string | null {
  if (!externalId.value.trim()) return 'external_id'
  return props.provider.secrets.find(name => !secrets[name]?.trim()) ?? null
}

async function submit() {
  if (busy.value) return
  failure.value = ''
  fieldErrors.value = {}
  const outOfRange = props.provider.secrets.find(name => !secretLengthOk(secrets[name] ?? ''))
  const missing = missingField()
  if (!missing && outOfRange) {
    fieldErrors.value = { [outOfRange]: t('integrations.new.secretLength', { min: SECRET_MIN, max: SECRET_MAX }) }
    await nextTick()
    document.getElementById(`${idBase}-${outOfRange}`)?.focus()
    return
  }
  if (missing) {
    fieldErrors.value = { [missing]: t('integrations.new.required') }
    await nextTick()
    document.getElementById(`${idBase}-${missing}`)?.focus()
    return
  }
  const appId = attributes.app_id?.trim()
  const body: IntegrationConnectionCreate = {
    provider: props.provider.code,
    external_id: externalId.value.trim(),
    ...(label.value.trim() ? { label: label.value.trim() } : {}),
    ...(appId ? { app_id: appId } : {}),
    secrets: typedValues(secrets),
  }
  try {
    const connection = await create.mutateAsync(body)
    saved.value = true
    emit('created', connection)
  } catch (error) {
    const field = failedField(error)
    const text = integrationErrorText(error, t)
    // A field the form does not render (the server names `secrets` for any key) is shown at the form level.
    if (field && renderedFields.value.has(field)) fieldErrors.value = { [field]: integrationServerMessage(error) || text }
    else failure.value = integrationServerMessage(error) || text
  }
}
</script>

<template>
  <UForm :state="{ externalId, label }" class="liwan-form" method="post" :loading-auto="false" novalidate data-testid="integration-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SettingsIntegrationProviderGuide v-if="hasIntegrationGuide(provider.code)" :code="provider.code" />
    <SharedFormSection panel :title="t('integrations.new.details')">
      <div class="grid gap-4">
        <UFormField :label="t('integrations.field.externalId')" :description="t('integrations.field.externalIdHint')" name="external_id" required :error="fieldErrors.external_id">
          <UInput :id="`${idBase}-external_id`" v-model="externalId" dir="ltr" class="w-full" required :disabled="busy" data-testid="integration-external-id" />
        </UFormField>
        <UFormField :label="t('integrations.field.label')" :description="t('integrations.field.labelHint')" name="label" :error="fieldErrors.label">
          <UInput :id="`${idBase}-label`" v-model="label" class="w-full" :disabled="busy" data-testid="integration-label" />
        </UFormField>
        <UFormField v-for="name in attributeNames" :key="name" :label="integrationAttributeLabel(name, t, te)" :description="t('integrations.field.appIdHint')" :name="name" :error="fieldErrors[name]">
          <UInput :id="`${idBase}-${name}`" v-model="attributes[name]" dir="ltr" class="w-full" :disabled="busy" :data-testid="`integration-attribute-${name}`" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection v-if="provider.secrets.length" panel :title="t('integrations.new.keys')" :description="t('integrations.new.keysHint')">
      <div class="grid gap-4">
        <UFormField v-for="name in provider.secrets" :key="name" :label="integrationSecretLabel(name, t, te)" :name="name" required :error="fieldErrors[name]">
          <UInput :id="`${idBase}-${name}`" v-model="secrets[name]" type="password" autocomplete="new-password" dir="ltr" class="w-full" required :disabled="busy" :data-testid="`integration-secret-${name}`" />
        </UFormField>
      </div>
    </SharedFormSection>
    <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="failure" data-testid="integration-form-error" />
    <SharedFormActions>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton :to="backTo" color="neutral" variant="outline" :disabled="create.isPending.value" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="busy" :loading="create.isPending.value" :label="t('integrations.new.submit')" data-testid="integration-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
