<script setup lang="ts">
import type { ProjectCreate } from '@liwan/contracts'
import { useProjectCreateDefaults } from '@/composables/useProjectSettings'
import { useCreateProject } from '@/composables/useProjects'
import ProjectBasicsFields from './ProjectBasicsFields.vue'
import type { ProjectBasicsDraft } from '@/utils/projectBasics'
import ProjectCopyForm from './ProjectCopyForm.vue'
import { mayFinalizeCreate, projectBasicsFromAi, readAiDraft } from '@/utils/aiDraft'
import { parsePositiveId } from '@/utils/routeParams'
import { saveErrorMessage } from '@/utils/formFeedback'

const emit = defineEmits<{ created: [id: number]; copied: [id: number]; cancel: [] }>()
const { t } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const copyFrom = computed(() => parsePositiveId(route.query.copyFrom))
const aiDraft = computed(() => hydrated.value && typeof route.query.aiDraft === 'string' ? readAiDraft(route.query.aiDraft) : null)
const { me } = useMe()
const { data: defaults, isPending: defaultsLoading, isError: defaultsFailed, refetch: refetchDefaults, isFetching: defaultsFetching } = useProjectCreateDefaults()
const { mutateAsync: createProject, isPending: creating } = useCreateProject()
const draft = ref<ProjectBasicsDraft>({ name: '', description: '', objectives: [{goal:'',metric:'',target:''}], success_criteria: '', user_id: null, date_start: null, date_end: null })
const initialized = ref(false)
const appliedAi = ref(false)
const baseline = ref('')
const saved = ref(false)
const error = ref('')
const attested = ref(false)
const dirty = computed(() => initialized.value && !saved.value && JSON.stringify(draft.value) !== baseline.value)
const defaultManagerName = computed(() => me.value && draft.value.user_id === me.value.id ? me.value.name : null)
watch([defaults, aiDraft], ([value, handoff]) => {
  if (!value) return
  if (!initialized.value) {
    draft.value.user_id = value.default_manager_id
    initialized.value = true
    baseline.value = JSON.stringify(draft.value)
  }
  if (handoff && !appliedAi.value && !dirty.value) {
    const payload = handoff.payload
    draft.value = projectBasicsFromAi(payload, draft.value)
    appliedAi.value = true
    baseline.value = JSON.stringify(draft.value)
  }
}, {immediate:true,flush:'sync'})
async function submit() {
  if (!hydrated.value || creating.value || !defaults.value || saved.value || !mayFinalizeCreate(!!aiDraft.value, attested.value)) return
  error.value = ''
  if (!draft.value.name.trim()) { error.value = t('projects.charter.errors.required'); return }
  if (defaults.value.require_manager_on_create && !draft.value.user_id) { error.value = t('projects.create.managerRequired'); return }
  if (defaults.value.require_end_date_on_create && !draft.value.date_end) { error.value = t('projects.create.endDateRequired'); return }
  if (draft.value.date_start && !draft.value.date_end) { error.value = t('projects.charter.errors.pair'); return }
  const body: ProjectCreate = { name: draft.value.name.trim(), description: draft.value.description, user_id: draft.value.user_id, objectives: draft.value.objectives.filter(row => row.goal.trim() || row.metric?.trim() || row.target?.trim()).map(row => ({...row})), success_criteria: draft.value.success_criteria, ...(draft.value.date_start ? {date_start:draft.value.date_start} : {}), ...(draft.value.date_end ? {date_end:draft.value.date_end} : {}) }
  try {
    const result = await createProject(body)
    saved.value = true
    await nextTick()
    emit('created', result.id)
  } catch (failure) {
    error.value = saveErrorMessage(failure, t('errors.generic'), t('errors.saveUncertain'))
  }
}
</script>
<template>
  <SharedFormSection v-if="copyFrom" :title="t('projects.copy.title')" :description="t('projects.copy.description')">
    <ProjectCopyForm :source-id="copyFrom" @created="emit('copied', $event)" @cancel="emit('cancel')" />
  </SharedFormSection>
  <SharedFormSection v-else :description="t('projects.basics.createHint')">
    <SharedUnsavedChanges :dirty="dirty" />
    <p v-if="defaultsLoading && !defaults" data-testid="project-create-loading" class="text-sm text-muted">{{ t('projects.create.loading') }}</p>
    <div v-if="defaultsFailed && !defaults" role="alert" data-testid="project-create-defaults-error">
      <p class="text-sm text-error">{{ t('projects.create.defaultsError') }}</p>
      <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || defaultsFetching" :label="t('app.retry')" @click="refetchDefaults()" />
    </div>
    <form class="liwan-form" data-testid="project-create-form" @submit.prevent="submit">
      <UBadge v-if="aiDraft" color="primary" variant="subtle">{{ t('projects.create.aiBadge') }}</UBadge>
      <ProjectBasicsFields v-model="draft" :disabled="!defaults || creating" :require-manager="defaults?.require_manager_on_create" :require-end-date="defaults?.require_end_date_on_create" :manager-name="defaultManagerName" />
      <UCheckbox v-if="aiDraft" v-model="attested" :disabled="!hydrated || creating" :label="t('projects.create.aiAttest')" data-testid="project-create-attestation" />
      <UAlert v-if="error" color="error" variant="subtle" :title="error" role="alert" data-testid="project-create-error" />
      <SharedFormActions>
        <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || creating" :label="t('app.cancel')" @click="emit('cancel')" />
        <UButton type="submit" :disabled="!hydrated || !defaults || creating || saved || !!aiDraft && !attested" :loading="creating" :label="t('projects.create.createFinal')" data-testid="project-create-submit" />
      </SharedFormActions>
    </form>
  </SharedFormSection>
</template>
