<script setup lang="ts">
import type { ProjectDetail } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useAddStage, useDeleteStage, useReorderStages, useUpdateStage } from '@/composables/useProjectStages'
import FollowerList from './FollowerList.vue'
import ProjectArchiveAction from './ProjectArchiveAction.vue'
import ProjectToolsSettings from './ProjectToolsSettings.vue'
import ProjectBasicsFields from './ProjectBasicsFields.vue'
import type { ProjectBasicsDraft } from '@/utils/projectBasics'
import { useProject, useUpdateProject } from '@/composables/useProjects'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import ProjectGeneralForm from './ProjectGeneralForm.vue'
import ProjectStatusSelect from './ProjectStatusSelect.vue'
import StageListEditor from './StageListEditor.vue'

const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()
const route = useRoute()

const hydrated = useHydrated()
const { mutateAsync: updateBasics, isPending: savingBasics } = useUpdateProject()
const { refetch: refetchProject } = useProject(computed(() => props.project.id))
const readBasics = (project: ProjectDetail): ProjectBasicsDraft => ({name:project.name,description:project.description_html,objectives:project.objectives.map(({goal,metric,target})=>({goal,metric,target})),success_criteria:project.success_criteria,user_id:project.manager?.id ?? null,date_start:project.date_start,date_end:project.date_end})
const basicsForm = useSettingsForm<ProjectDetail, ProjectBasicsDraft>({
  source: () => props.project,
  read: readBasics,
  save: async (draft, latest) => {
    if (!hydrated.value || !latest.active || !latest.can_manage) throw new ApiError(403, 'forbidden', t('errors.generic'))
    if (!draft.name.trim()) throw new ApiError(422, 'invalid', t('projects.charter.errors.required'), 'name')
    const before = readBasics(latest)
    const changed = Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof ProjectBasicsDraft])))
    if (changed.objectives) changed.objectives = draft.objectives.filter(row => row.goal.trim() || row.metric?.trim() || row.target?.trim())
    try {
      return await updateBasics({id:latest.id,patch:{...changed,expected_updated_at:latest.updated_at}})
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409 && failure.code === 'stale_write') {
        await refetchProject()
        throw new ApiError(409, 'conflict', failure.message)
      }
      throw failure
    }
  },
  reload: async () => {
    const result = await refetchProject()
    if (result.isError) throw result.error
    return result.data ?? props.project
  },
})
const basics = basicsForm.draft

const toast = useToast()

const { mutate: addStage, isPending: adding } = useAddStage()
const { mutate: updateStage, isPending: updating } = useUpdateStage()
const { mutate: reorderStages, isPending: reordering } = useReorderStages()
const { mutate: deleteStage, isPending: deleting } = useDeleteStage()
const stagesBusy = computed(() => adding.value || updating.value || reordering.value || deleting.value)
const sortedStages = computed(() => [...props.project.stages].sort((a, b) => a.sequence - b.sequence || a.id - b.id))

function onApiError(e: unknown) {
  toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
}
const stageEditor = ref<InstanceType<typeof StageListEditor> | null>(null)
function onAddStage(name: string) {
  addStage({ projectId: props.project.id, name }, {
    onSuccess: () => { stageEditor.value?.clearNewName(); toast.add({ title: t('projects.toast.stageAdded'), color: 'success' }) },
    onError: onApiError,
  })
}
function onRenameStage(id: number | string, name: string) {
  updateStage({ projectId: props.project.id, id: Number(id), patch: { name } }, { onSuccess: () => toast.add({ title: t('projects.toast.stageRenamed'), color: 'success' }), onError: onApiError })
}
function onFoldStage(id: number | string, fold: boolean) { updateStage({ projectId: props.project.id, id: Number(id), patch: { fold } }, { onError: onApiError }) }
function onReorderStages(ids: (number | string)[]) {
  reorderStages({ projectId: props.project.id, ids: ids.map(Number) }, {
    onSuccess: () => toast.add({ title: t('projects.toast.stagesReordered'), color: 'success' }),
    onError: (e) => { stageEditor.value?.restoreOrder(); onApiError(e) },
  })
}
function onDeleteStage(id: number | string) {
  deleteStage({ projectId: props.project.id, id: Number(id) }, { onSuccess: () => toast.add({ title: t('projects.stages.deleted'), color: 'success' }), onError: onApiError })
}
</script>

<template>
  <div data-testid="project-settings-page" class="grid gap-(--liwan-gap-card)">
    <SharedRecordSection variant="tinted">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-muted">{{ t('projects.refresh.settings.individualScope') }}</p>
        <NuxtLink v-if="project.tools.governance.enabled" :to="{ path: `/projects/${project.id}/charter`, query: { ...route.query, returnTo: route.fullPath } }" class="text-sm font-medium text-brand-link underline underline-offset-4">
          {{ t('projects.refresh.settings.openCharter') }}
        </NuxtLink>
      </div>
    </SharedRecordSection>
    <SharedSettingsCard id="project-basics" :title="t('projects.basics.title')" v-bind="basicsForm.state.value" :can-edit="project.can_manage && project.active" @save="basicsForm.save" @revert="basicsForm.revert" @reload="basicsForm.reload">
      <ProjectBasicsFields v-model="basics" :disabled="savingBasics || basicsForm.state.value.conflict || !project.active || !project.can_manage" :manager-name="project.manager?.name" />
    </SharedSettingsCard>
    <ProjectToolsSettings :project="project" />
    <SharedFormSection panel :title="t('projects.settings.status.title')" :description="t('projects.settings.status.description')">
      <ProjectStatusSelect :project="project" />
    </SharedFormSection>
    <SharedFormSection panel :title="t('projects.refresh.settings.operation.title')" :description="t('projects.refresh.settings.operation.description')">
      <ProjectGeneralForm :project="project" />
    </SharedFormSection>
    <SharedFormSection panel :title="t('projects.settings.tabs.stages')" :description="t('projects.refresh.settings.stagesDescription')">
      <StageListEditor ref="stageEditor" :stages="sortedStages" :busy="stagesBusy" @add="onAddStage" @rename="onRenameStage" @fold="onFoldStage" @reorder="onReorderStages" @delete="onDeleteStage" />
    </SharedFormSection>
    <SharedFormSection panel :title="t('projects.settings.tabs.followers')" :description="t('projects.refresh.settings.followersDescription')">
      <FollowerList :project="project" />
    </SharedFormSection>
    <SharedFormSection panel :title="t('projects.refresh.settings.archive.title')" :description="t('projects.refresh.settings.archive.description')">
      <ProjectArchiveAction :project="project" />
    </SharedFormSection>
  </div>
</template>
