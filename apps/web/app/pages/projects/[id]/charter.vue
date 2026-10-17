<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { useMilestones } from '@/composables/useMilestones'
import ProjectCharterForm from '@/components/pmo/projects/ProjectCharterForm.vue'
import CharterApprovalPanel from '@/components/pmo/projects/CharterApprovalPanel.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error, refetch } = useProject(projectId)
const {
  data: milestones,
  isLoading: milestonesLoading,
  error: milestonesError,
  refetch: refetchMilestones,
} = useMilestones(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const readonly = computed(() => route.query.edit !== '1' || !(project.value?.can_manage ?? false) || project.value?.charter.state === 'submitted')
const charterState = computed(() => project.value?.charter.state ?? null)
const isDraft = computed(() => charterState.value === 'draft')

function leaveEdit() {
  if (projectId.value) void router.push({ path: `/projects/${projectId.value}/charter`, query: { ...route.query, edit: undefined, step: undefined } })
}

function onSaved(outcome: 'saved' | 'approved' | 'submitted' | 'reopened') {
  const titles = { saved: 'projects.charter.saved', approved: 'projects.charter.finalized', submitted: 'projects.charter.submitted', reopened: 'projects.charter.reopened' }
  const reopened = outcome === 'reopened'
  toast.add({
    title: t(titles[outcome]),
    color: reopened ? 'warning' : 'success',
    icon: reopened ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check',
  })
  leaveEdit()
}

function onDraftSaved() {
  toast.add({ title: t('projects.charter.draftSaved'), color: 'success', icon: 'i-lucide-save' })
}

function onCancel() {
  leaveEdit()
}
</script>

<template>
  <SharedStandalonePage v-if="readonly" variant="print" width="list">
    <!-- The "Project charter" sub-tab already names this page (DESIGN 4): the state and the edit action live in the essentials panel header. -->
    <SharedPageHeader class="webvue-print-hide" hide-title :title="t('projects.charter.title')" />
    <CharterApprovalPanel v-if="project" :project="project" />
    <p v-if="projectId === null" class="text-muted">{{ t('projects.invalidId') }}</p>
    <SharedPageState v-else :loading="isLoading && !project" :error="notFound ? null : error" :empty="notFound || (!isLoading && !error && !project)" :empty-text="notFound ? t('projects.notFound') : t('projects.empty')" @retry="refetch">
      <ProjectCharterForm mode="edit" :project="project" readonly :milestones="milestones ?? []" :milestones-loading="milestonesLoading" :milestones-error="milestonesError" @retry-milestones="refetchMilestones">
        <template #state>
          <SharedStatusBadge v-if="charterState" data-testid="charter-state-badge" :tone="isDraft ? 'warning' : charterState === 'submitted' ? 'info' : 'success'" :label="t(`projects.charter.state.${charterState}`)" :aria-label="`${t('projects.charter.stateLabel')}: ${t(`projects.charter.state.${charterState}`)}`" />
        </template>
        <template #actions>
          <UButton v-if="project?.can_manage && charterState !== 'submitted'" data-testid="project-charter-edit" :disabled="!hydrated" @click="router.push({ path: route.path, query: { ...route.query, edit: '1' } })">{{ t(isDraft ? 'projects.charter.continueDraft' : 'app.edit') }}</UButton>
        </template>
      </ProjectCharterForm>
    </SharedPageState>
  </SharedStandalonePage>
  <SharedPageContainer v-else width="form">
    <SharedPageHeader :title="t('projects.clarity.editCharter')">
      <template #actions>
        <SharedStatusBadge v-if="charterState" data-testid="charter-state-badge" :tone="isDraft ? 'warning' : charterState === 'submitted' ? 'info' : 'success'" :label="t(`projects.charter.state.${charterState}`)" :aria-label="`${t('projects.charter.stateLabel')}: ${t(`projects.charter.state.${charterState}`)}`" />
      </template>
    </SharedPageHeader>
    <p v-if="projectId === null" class="text-muted">{{ t('projects.invalidId') }}</p>
    <SharedPageState v-else :loading="isLoading && !project" :error="notFound ? null : error" :empty="notFound || (!isLoading && !error && !project)" :empty-text="notFound ? t('projects.notFound') : t('projects.empty')" @retry="refetch">
      <div class="grid gap-(--webvue-gap-card)">
        <UAlert v-if="project && charterState === 'draft' && project.charter.return_note" color="warning" variant="subtle" icon="i-lucide-undo-2" data-testid="charter-returned" :title="t('projects.charter.returned')" :description="project.charter.return_note" />
        <SharedFormSection panel>
          <ProjectCharterForm mode="edit" :project="project" :readonly="false" :milestones="milestones ?? []" :milestones-loading="milestonesLoading" :milestones-error="milestonesError" @saved="onSaved" @draft-saved="onDraftSaved" @cancel="onCancel" @retry-milestones="refetchMilestones" />
        </SharedFormSection>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
