<script setup lang="ts">
import { inject } from 'vue'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { useMilestones } from '@/composables/useMilestones'
import ProjectCharterForm from '@/components/project/ProjectCharterForm.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const isProjectOverlay = inject<boolean>(Symbol.for('nasq.project.overlay'), false)
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

function onSaved() {
  toast.success(t('projects.charter.saved'))
}

function onCancel() {
  if (projectId.value) void router.push({ path: `/projects/${projectId.value}/charter`, query: { ...route.query, edit: undefined } })
}
</script>

<template>
  <SharedPageContainer :width="readonly ? 'detail' : 'form'">
    <SharedPageHeader
      :title="t(readonly ? 'projects.charter.title' : 'projects.clarity.editCharter')"
    >
      <template #actions>
        <Button v-if="project?.can_manage && readonly" :disabled="!hydrated" @click="router.push({ path: route.path, query: { ...route.query, edit: '1' } })">{{ t('app.edit') }}</Button>
      </template>
    </SharedPageHeader>
    <template v-if="projectId === null">
      <p class="text-muted-foreground">{{ t('projects.invalidId') }}</p>
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
        <Card class="nasq-form">
          <CardContent class="pt-6">
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
          </CardContent>
        </Card>
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
