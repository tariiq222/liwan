<script setup lang="ts">
import type { CrmImportColumns, CrmImportFile, CrmImportPreview, CrmImportRequest } from '@liwan/contracts'
import CrmImportMappingStep from './CrmImportMappingStep.vue'
import CrmImportPreviewStep from './CrmImportPreviewStep.vue'
import CrmImportUploadStep from './CrmImportUploadStep.vue'
import { useCrmImportActions, useCrmImportMappings } from '@/composables/crm/useCrmImports'
import { useCrmSourceChoices } from '@/composables/crm/useCrmLists'
import { useCrmSettings } from '@/composables/crm/useCrmSettings'
import { useCrmTerms } from '@/composables/crm/useCrmTerms'
import { CRM_LIST_PATH } from '@/utils/crmOpportunity'
import { crmImportErrorMessage, importFileMessageKey, importFileProblem, mappingBody, mappingIsComplete, readImportFile, type MappingDraft } from '@/utils/crmImport'

// The import in three steps inside the route-backed panel: the file, the column mapping with the source (and the agent
// when distribution is "on import"), then the preview and the confirmation. Nothing is created before the last button.
const props = defineProps<{ cancelTo: string }>()
const { t } = useI18n()
const toast = useToast()
const { can } = useAccess()
const { term } = useCrmTerms()
const actions = useCrmImportActions()
const profiles = useCrmImportMappings()
const sources = useCrmSourceChoices()
const settings = useCrmSettings()

type Step = 'upload' | 'mapping' | 'preview'
const STEPS: Step[] = ['upload', 'mapping', 'preview']
const step = ref<Step>('upload')
const file = ref<CrmImportFile | null>(null)
const info = ref<{ columns: string[]; rows: number } | null>(null)
const reading = ref(false)
const fileError = ref('')
const mapping = ref<MappingDraft>({})
const profileId = ref<number | null>(null)
const sourceId = ref<number | undefined>()
const agentId = ref<number | null>(null)
const saveProfile = ref(false)
const profileName = ref('')
const preview = ref<CrmImportPreview | null>(null)
const mappingError = ref('')
const confirmError = ref('')
const checking = ref(false)
const finished = ref(false)
const upload = ref<{ reset: () => void } | null>(null)

// The mode is known to those who read the settings; an importer without that capability sees an optional picker.
const agentMode = computed<'required' | 'optional' | 'none'>(() => {
  if (!can('crm.leads.assign')) return 'none'
  if (!can('crm.settings.read')) return 'optional'
  const mode = settings.data.value?.values.distribution_mode
  return mode === 'on_import' ? 'required' : 'none'
})
const stepNumber = computed(() => STEPS.indexOf(step.value) + 1)
const stepTitle = computed(() => t('crm.imports.flow.step', { current: stepNumber.value, total: STEPS.length, name: t(`crm.imports.flow.steps.${step.value}`) }))
const fileInfo = computed(() => (file.value && info.value ? t('crm.imports.flow.upload.info', { name: file.value.file_name, columns: info.value.columns.length, rows: info.value.rows }) : ''))
const dirty = computed(() => file.value !== null && !finished.value)
const chosenAgent = computed(() => (agentMode.value !== 'none' ? agentId.value : null))

function requestBody(): CrmImportRequest | null {
  if (!file.value || !sourceId.value) return null
  const columns = profileId.value === null ? mappingBody(mapping.value) : null
  if (profileId.value === null && !columns) return null
  const body: CrmImportRequest = { ...file.value, source_id: sourceId.value }
  if (columns) body.mapping = columns
  else body.mapping_profile = profileId.value
  if (chosenAgent.value) body.user_id = chosenAgent.value
  return body
}

async function choose(chosen: File) {
  fileError.value = ''
  const problem = importFileProblem(chosen)
  if (problem) {
    fileError.value = t(importFileMessageKey(problem))
    upload.value?.reset()
    return
  }
  reading.value = true
  try {
    const read = await readImportFile(chosen)
    const result = await actions.columns.mutateAsync(read)
    file.value = read
    info.value = result
    mapping.value = {}
    profileId.value = null
    step.value = 'mapping'
  } catch (error) {
    fileError.value = crmImportErrorMessage(error, t)
    upload.value?.reset()
  } finally {
    reading.value = false
  }
}

async function toPreview() {
  mappingError.value = ''
  const body = requestBody()
  const needsAgent = agentMode.value === 'required' && !agentId.value
  if (!body || needsAgent || (saveProfile.value && !profileName.value.trim())) {
    mappingError.value = t(needsAgent && mappingIsComplete(mapping.value) && sourceId.value ? 'crm.imports.flow.mapping.agentRequired' : 'crm.imports.flow.mapping.required')
    return
  }
  checking.value = true
  try {
    preview.value = await actions.preview.mutateAsync(body)
    confirmError.value = ''
    step.value = 'preview'
  } catch (error) {
    mappingError.value = crmImportErrorMessage(error, t, { agentChosen: Boolean(chosenAgent.value) })
  } finally {
    checking.value = false
  }
}

// The saved mapping is created here, with the import: a name already taken is refused before any record exists, and
// the import then goes by the new profile's id.
async function saveChosenProfile(columns: CrmImportColumns) {
  const saved = await actions.saveMapping.mutateAsync({ name: profileName.value.trim(), columns })
  profileId.value = saved.id
  saveProfile.value = false
}

async function commitImport() {
  if (!requestBody() || checking.value) return
  confirmError.value = ''
  checking.value = true
  try {
    const columns = mappingBody(mapping.value)
    if (saveProfile.value && profileId.value === null && columns) await saveChosenProfile(columns)
    const batch = await actions.commit.mutateAsync(requestBody()!)
    finished.value = true
    toast.add({ title: t('crm.imports.flow.preview.done', { count: batch.created, name: batch.file_name }), color: 'success' })
    await navigateTo(CRM_LIST_PATH)
  } catch (error) {
    confirmError.value = crmImportErrorMessage(error, t, { agentChosen: Boolean(chosenAgent.value) })
  } finally {
    checking.value = false
  }
}

async function removeProfile(id: number) {
  try {
    await actions.deleteMapping.mutateAsync(id)
  } catch (error) {
    mappingError.value = crmImportErrorMessage(error, t)
  }
}

function back() {
  mappingError.value = ''
  step.value = step.value === 'preview' ? 'mapping' : 'upload'
}
const submit = () => (step.value === 'mapping' ? toPreview() : step.value === 'preview' ? commitImport() : undefined)
</script>

<template>
  <UForm novalidate :state="{}" class="liwan-form" data-testid="crm-import-flow" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty && !checking" />
    <div class="grid gap-5">
      <div class="grid gap-1">
        <p class="text-sm font-semibold text-highlighted" data-testid="crm-import-step">{{ stepTitle }}</p>
        <p v-if="fileInfo" class="text-sm text-muted" data-testid="crm-import-file-info"><bdi>{{ fileInfo }}</bdi></p>
      </div>
      <CrmImportUploadStep v-if="step === 'upload'" ref="upload" :reading="reading" :error="fileError" @choose="choose" />
      <CrmImportMappingStep
        v-else-if="step === 'mapping' && info"
        v-model:mapping="mapping" v-model:profile-id="profileId" v-model:source-id="sourceId" v-model:agent-id="agentId"
        v-model:save-profile="saveProfile" v-model:profile-name="profileName"
        :columns="info.columns" :profiles="profiles.data.value?.items ?? []" :sources="sources.data.value?.items ?? []" :agent-mode="agentMode"
        :package-label="term('package', 'one')" :error="mappingError" :pending="checking" :deleting="actions.deleteMapping.isPending.value" @delete-profile="removeProfile"
      />
      <template v-else-if="step === 'preview' && preview">
        <CrmImportPreviewStep :preview="preview" />
        <UAlert v-if="confirmError" role="alert" color="error" variant="subtle" :description="confirmError" data-testid="crm-import-confirm-error" />
      </template>
    </div>
    <SharedFormActions>
      <UButton v-if="step === 'upload'" type="button" color="neutral" variant="outline" :to="props.cancelTo" :label="t('app.cancel')" />
      <UButton v-else type="button" color="neutral" variant="outline" :disabled="checking" :label="t('crm.imports.flow.back')" data-testid="crm-import-back" @click="back" />
      <UButton v-if="step === 'mapping'" type="submit" class="ms-auto" :loading="checking" :disabled="checking" :label="t('crm.imports.flow.next')" data-testid="crm-import-next" />
      <UButton v-else-if="step === 'preview'" type="submit" class="ms-auto" :loading="checking" :disabled="checking || !preview?.new" :label="t('crm.imports.flow.preview.confirm', { count: preview?.new ?? 0 })" data-testid="crm-import-confirm" />
    </SharedFormActions>
  </UForm>
</template>
