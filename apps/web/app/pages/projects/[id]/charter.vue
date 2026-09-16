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
// Governance groups these four pages behind one card list; that card list is the
// way back, and the project tab strip has no tab of its own for them.
const backTo = computed(() => `/projects/${projectId.value}/governance`)
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
  <SharedPageContainer :width="readonly ? 'list' : 'form'">
    <SharedPageHeader
      :title="t(readonly ? 'projects.charter.title' : 'projects.clarity.editCharter')"
      :back-to="backTo"
      :back-label="t('projects.workspace.groups.governance')"
    >
      <template #actions>
        <UBadge
          v-if="charterState"
          data-testid="charter-state-badge"
          :color="isDraft ? 'warning' : 'success'"
          variant="subtle"
          :label="t(`projects.charter.state.${charterState}`)"
          :aria-label="`${t('projects.charter.stateLabel')}: ${t(`projects.charter.state.${charterState}`)}`"
        />
        <UButton v-if="project?.can_manage && readonly" data-testid="project-charter-edit" :disabled="!hydrated" @click="router.push({ path: route.path, query: { ...route.query, edit: '1' } })">{{ t(isDraft ? 'projects.charter.continueDraft' : 'app.edit') }}</UButton>
      </template>
    </SharedPageHeader>
    <UAlert
      v-if="readonly && isDraft && project"
      data-testid="charter-draft-banner"
      color="warning"
      variant="subtle"
      icon="i-lucide-pencil-line"
      :title="t('projects.charter.draftBanner')"
    />
    <template v-if="projectId === null">
      <p class="text-muted">{{ t('projects.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="isLoading && !project"
      :error="notFound ? null : error"
      :empty="notFound || (!isLoading && !error && !project)"
      :empty-text="notFound ? t('projects.notFound') : t('projects.empty')"
      @retry="refetch"
    >
      <div class="project-charter-print-scope">
        <div :class="readonly ? undefined : 'nasq-ui-record-surface p-5'">
            <ProjectCharterForm
              mode="edit"
              :project="project"
              :readonly="readonly"
              :milestones="milestones ?? []"
              :milestones-loading="milestonesLoading"
              :milestones-error="milestonesError"
              @saved="onSaved"
              @draft-saved="onDraftSaved"
              @cancel="onCancel"
              @retry-milestones="refetchMilestones"
            />
        </div>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>

<style scoped>
@media print {
  :global(body *) {
    visibility: hidden;
  }

  :global(.project-charter-print-scope),
  :global(.project-charter-print-scope *) {
    visibility: visible;
  }

  :global(.project-charter-print-scope) {
    position: absolute;
    inset: 0;
    width: 100%;
  }
}
</style>
