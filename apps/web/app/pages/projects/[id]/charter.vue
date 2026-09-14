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

function onSaved() {
  toast.add({ title: t('projects.charter.saved'), color: 'success', icon: 'i-lucide-circle-check' })
}

function onCancel() {
  if (projectId.value) void router.push({ path: `/projects/${projectId.value}/charter`, query: { ...route.query, edit: undefined } })
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
        <UButton v-if="project?.can_manage && readonly" :disabled="!hydrated" @click="router.push({ path: route.path, query: { ...route.query, edit: '1' } })">{{ t('app.edit') }}</UButton>
      </template>
    </SharedPageHeader>
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
        <div :class="readonly ? undefined : 'rounded-lg ring ring-default bg-default overflow-hidden p-5'">
            <ProjectCharterForm
              mode="edit"
              :project="project"
              :readonly="readonly"
              :milestones="milestones ?? []"
              :milestones-loading="milestonesLoading"
              :milestones-error="milestonesError"
              @saved="onSaved"
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
