<script setup lang="ts">
import type { CrmImportMapping, CrmSource } from '@liwan/contracts'
import { draftFromColumns, IMPORT_FIELDS, REQUIRED_IMPORT_FIELDS, type ImportField, type MappingDraft } from '@/utils/crmImport'

// Step 2: which column of the file feeds each detail, the source of the batch and, when distribution is "on import",
// the agent who takes it. A saved mapping fills the columns and is sent by id; "save this mapping" keeps the chosen ones.
// `agentMode`: `required` (distribution is on import), `optional` (the importer cannot read the settings, so the mode is unknown) or `none`.
const props = defineProps<{
  columns: string[]
  profiles: CrmImportMapping[]
  sources: CrmSource[]
  agentMode: 'required' | 'optional' | 'none'
  packageLabel: string
  error?: string
  pending?: boolean
  deleting?: boolean
}>()
const emit = defineEmits<{ deleteProfile: [id: number] }>()
const mapping = defineModel<MappingDraft>('mapping', { required: true })
const profileId = defineModel<number | null>('profileId', { required: true })
const sourceId = defineModel<number | undefined>('sourceId', { required: true })
const agentId = defineModel<number | null>('agentId', { required: true })
const saveProfile = defineModel<boolean>('saveProfile', { required: true })
const profileName = defineModel<string>('profileName', { required: true })
const { t } = useI18n()
const hydrated = useHydrated()
const NONE = '__none'
const confirmingDelete = ref(false)

const locked = computed(() => profileId.value !== null)
const disabled = computed(() => !hydrated.value || props.pending)
const columnItems = computed(() => props.columns.map(column => ({ value: column, label: column })))
const optionalItems = computed(() => [{ value: NONE, label: t('crm.imports.flow.mapping.noColumn') }, ...columnItems.value])
const profileItems = computed(() => [{ value: NONE, label: t('crm.imports.flow.mapping.profileNone') }, ...props.profiles.map(profile => ({ value: String(profile.id), label: profile.name }))])
const label = (field: ImportField) => t(`crm.imports.flow.mapping.fields.${field}`, { term: props.packageLabel })
const required = (field: ImportField) => REQUIRED_IMPORT_FIELDS.includes(field)

function setColumn(field: ImportField, value: unknown) {
  const next = { ...mapping.value }
  if (typeof value === 'string' && value !== NONE) next[field] = value
  else delete next[field]
  mapping.value = next
}
// Choosing a saved mapping shows its columns and locks them; "none" unlocks them and keeps what was shown.
function chooseProfile(value: unknown) {
  confirmingDelete.value = false
  const profile = props.profiles.find(item => String(item.id) === value)
  profileId.value = profile?.id ?? null
  if (profile) {
    mapping.value = draftFromColumns(profile.columns)
    saveProfile.value = false
  }
}
function confirmDelete() {
  const id = profileId.value
  if (id === null) return
  confirmingDelete.value = false
  profileId.value = null
  emit('deleteProfile', id)
}
</script>

<template>
  <div class="grid gap-5" data-testid="crm-import-mapping">
    <p class="text-sm text-muted">{{ t('crm.imports.flow.mapping.hint') }}</p>
    <UFormField v-if="profiles.length" :label="t('crm.imports.flow.mapping.profile')" name="import-profile">
      <div class="flex min-w-0 items-center gap-2">
        <USelect id="import-profile" class="min-w-0 flex-1" :model-value="profileId === null ? NONE : String(profileId)" :items="profileItems" :placeholder="t('crm.imports.flow.mapping.profilePlaceholder')" :disabled="disabled" @update:model-value="chooseProfile" />
        <UButton v-if="locked" type="button" color="neutral" variant="ghost" square icon="i-lucide-trash-2" :aria-label="t('crm.imports.flow.mapping.profileDelete')" :disabled="disabled || deleting" @click="confirmingDelete = true" />
      </div>
    </UFormField>
    <SharedInlineConfirm v-if="confirmingDelete" :title="t('crm.imports.flow.mapping.profileDeleteTitle')" :description="t('crm.imports.flow.mapping.profileDeleteBody')" :confirm-label="t('crm.imports.flow.mapping.profileDeleteConfirm')" :pending="deleting" @confirm="confirmDelete" @cancel="confirmingDelete = false" />

    <SharedFormSection>
      <UFormField v-for="field in IMPORT_FIELDS" :key="field" :label="label(field)" :name="`import-field-${field}`" :required="required(field)">
        <USelect :id="`import-field-${field}`" class="w-full" :model-value="mapping[field] ?? (required(field) ? undefined : NONE)" :items="required(field) ? columnItems : optionalItems" :placeholder="t('crm.imports.flow.mapping.column')" :disabled="disabled || locked" @update:model-value="value => setColumn(field, value)" />
      </UFormField>
      <UFormField :label="t('crm.imports.flow.mapping.source')" name="import-field-source" required>
        <USelect id="import-field-source" v-model="sourceId" class="w-full" :items="sources.map(source => ({ value: source.id, label: source.name }))" :placeholder="t('crm.imports.flow.mapping.sourcePlaceholder')" :disabled="disabled" />
      </UFormField>
      <UFormField v-if="agentMode !== 'none'" :label="t('crm.imports.flow.mapping.agent')" name="import-agent" :required="agentMode === 'required'" :help="t(agentMode === 'required' ? 'crm.imports.flow.mapping.agentHint' : 'crm.imports.flow.mapping.agentOptionalHint')">
        <SharedPersonPicker id="import-agent" v-model="agentId" value-key="user_id" endpoint="/api/v1/crm/agents" :placeholder="t('crm.imports.flow.mapping.agentPlaceholder')" :disabled="disabled" />
      </UFormField>
    </SharedFormSection>

    <div v-if="!locked" class="grid gap-3">
      <USwitch v-model="saveProfile" :label="t('crm.imports.flow.mapping.save')" :description="t('crm.imports.flow.mapping.saveHint')" :disabled="disabled" />
      <UFormField v-if="saveProfile" :label="t('crm.imports.flow.mapping.saveName')" name="import-profile-name" required>
        <UInput id="import-profile-name" v-model="profileName" class="w-full" :maxlength="200" :disabled="disabled" />
      </UFormField>
    </div>
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :description="error" data-testid="crm-import-mapping-error" />
  </div>
</template>
