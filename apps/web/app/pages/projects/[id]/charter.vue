<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { useMilestones } from '@/composables/useMilestones'
import ProjectCharterForm from '@/components/project/ProjectCharterForm.vue'

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
const readonly = computed(() => route.query.edit !== '1' || !(project.value?.can_manage ?? false))
const charterState = computed(() => project.value?.charter.state ?? null)
const isDraft = computed(() => charterState.value === 'draft')

function leaveEdit() {
  if (projectId.value) void router.push({ path: `/projects/${projectId.value}/charter`, query: { ...route.query, edit: undefined, step: undefined } })
}

function onSaved(finalized: boolean) {
  toast.add({
    title: t(finalized ? 'projects.charter.finalized' : 'projects.charter.saved'),
    color: 'success',
    icon: 'i-lucide-circle-check',
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
  <SharedStandalonePage v-if="readonly" variant="print">
    <!-- The "Project charter" sub-tab already names this page (DESIGN 4): the header keeps only the state and the edit action. -->
    <SharedPageHeader class="nasq-print-hide" hide-title :title="t('projects.charter.title')">
      <template #actions>
        <SharedStatusBadge v-if="charterState" data-testid="charter-state-badge" :tone="isDraft ? 'warning' : 'success'" :label="t(`projects.charter.state.${charterState}`)" :aria-label="`${t('projects.charter.stateLabel')}: ${t(`projects.charter.state.${charterState}`)}`" />
        <UButton v-if="project?.can_manage" data-testid="project-charter-edit" :disabled="!hydrated" @click="router.push({ path: route.path, query: { ...route.query, edit: '1' } })">{{ t(isDraft ? 'projects.charter.continueDraft' : 'app.edit') }}</UButton>
      </template>
    </SharedPageHeader>
    <UAlert v-if="isDraft && project" class="nasq-print-hide" data-testid="charter-draft-banner" color="warning" variant="subtle" icon="i-lucide-pencil-line" :title="t('projects.charter.draftBanner')" />
    <p v-if="projectId === null" class="text-muted">{{ t('projects.invalidId') }}</p>
    <SharedPageState v-else :loading="isLoading && !project" :error="notFound ? null : error" :empty="notFound || (!isLoading && !error && !project)" :empty-text="notFound ? t('projects.notFound') : t('projects.empty')" @retry="refetch">
      <ProjectCharterForm mode="edit" :project="project" readonly :milestones="milestones ?? []" :milestones-loading="milestonesLoading" :milestones-error="milestonesError" @retry-milestones="refetchMilestones" />
    </SharedPageState>
  </SharedStandalonePage>
  <SharedPageContainer v-else width="form">
    <SharedPageHeader :title="t('projects.clarity.editCharter')">
      <template #actions>
        <SharedStatusBadge v-if="charterState" data-testid="charter-state-badge" :tone="isDraft ? 'warning' : 'success'" :label="t(`projects.charter.state.${charterState}`)" :aria-label="`${t('projects.charter.stateLabel')}: ${t(`projects.charter.state.${charterState}`)}`" />
      </template>
    </SharedPageHeader>
    <p v-if="projectId === null" class="text-muted">{{ t('projects.invalidId') }}</p>
    <SharedPageState v-else :loading="isLoading && !project" :error="notFound ? null : error" :empty="notFound || (!isLoading && !error && !project)" :empty-text="notFound ? t('projects.notFound') : t('projects.empty')" @retry="refetch">
      <SharedFormSection panel>
        <ProjectCharterForm mode="edit" :project="project" :readonly="false" :milestones="milestones ?? []" :milestones-loading="milestonesLoading" :milestones-error="milestonesError" @saved="onSaved" @draft-saved="onDraftSaved" @cancel="onCancel" @retry-milestones="refetchMilestones" />
      </SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
</template>
