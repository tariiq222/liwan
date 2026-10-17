<script setup lang="ts">
import type { ProjectDetail } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { useAddStage, useDeleteStage, useReorderStages, useUpdateStage } from '@/composables/useProjectStages'
import FollowerList from './FollowerList.vue'
import ProjectArchiveAction from './ProjectArchiveAction.vue'
import ProjectGeneralForm from './ProjectGeneralForm.vue'
import ProjectStatusSelect from './ProjectStatusSelect.vue'
import StageListEditor from './StageListEditor.vue'

const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()
const route = useRoute()
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
function onAddStage(name: string) { addStage({ projectId: props.project.id, name }, { onError: onApiError }) }
function onRenameStage(id: number | string, name: string) { updateStage({ projectId: props.project.id, id: Number(id), patch: { name } }, { onError: onApiError }) }
function onFoldStage(id: number | string, fold: boolean) { updateStage({ projectId: props.project.id, id: Number(id), patch: { fold } }, { onError: onApiError }) }
function onReorderStages(ids: (number | string)[]) { reorderStages({ projectId: props.project.id, ids: ids.map(Number) }, { onError: onApiError }) }
function onDeleteStage(id: number | string) {
  deleteStage({ projectId: props.project.id, id: Number(id) }, { onSuccess: () => toast.add({ title: t('projects.stages.deleted'), color: 'success' }), onError: onApiError })
}
</script>

<template>
  <div data-testid="project-settings-page" class="grid gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-card bg-default px-4 py-3 text-sm ring ring-default">
      <p class="text-sm text-muted">{{ t('projects.refresh.settings.individualScope') }}</p>
      <NuxtLink :to="{ path: `/projects/${project.id}/charter`, query: { ...route.query, returnTo: route.fullPath } }" class="text-sm underline underline-offset-4">
        {{ t('projects.refresh.settings.openCharter') }}
      </NuxtLink>
    </div>
    <SharedFormSection panel :title="t('projects.settings.status.title')" :description="t('projects.settings.status.description')">
      <ProjectStatusSelect :project="project" />
    </SharedFormSection>
    <SharedFormSection panel :title="t('projects.refresh.settings.operation.title')" :description="t('projects.refresh.settings.operation.description')">
      <ProjectGeneralForm :project="project" />
    </SharedFormSection>
    <SharedFormSection panel :title="t('projects.settings.tabs.stages')" :description="t('projects.refresh.settings.stagesDescription')">
      <StageListEditor :stages="sortedStages" :busy="stagesBusy" @add="onAddStage" @rename="onRenameStage" @fold="onFoldStage" @reorder="onReorderStages" @delete="onDeleteStage" />
    </SharedFormSection>
    <SharedFormSection panel :title="t('projects.settings.tabs.followers')" :description="t('projects.refresh.settings.followersDescription')">
      <FollowerList :project="project" />
    </SharedFormSection>
    <SharedFormSection panel :title="t('projects.refresh.settings.archive.title')" :description="t('projects.refresh.settings.archive.description')">
      <ProjectArchiveAction :project="project" />
    </SharedFormSection>
  </div>
</template>
