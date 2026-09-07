<script setup lang="ts">
import type { ProjectDetail } from '@nasq/contracts'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useAddStage, useDeleteStage, useReorderStages, useUpdateStage } from '@/composables/useProjectStages'
import FollowerList from './FollowerList.vue'
import ProjectGeneralForm from './ProjectGeneralForm.vue'
import StageListEditor from './StageListEditor.vue'

const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()

const { mutate: addStage, isPending: adding } = useAddStage()
const { mutate: updateStage, isPending: updating } = useUpdateStage()
const { mutate: reorderStages, isPending: reordering } = useReorderStages()
const { mutate: deleteStage, isPending: deleting } = useDeleteStage()
const stagesBusy = computed(() => adding.value || updating.value || reordering.value || deleting.value)
const sortedStages = computed(() => [...props.project.stages].sort((a, b) => a.sequence - b.sequence || a.id - b.id))

function onApiError(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
}
function onAddStage(name: string) { addStage({ projectId: props.project.id, name }, { onError: onApiError }) }
function onRenameStage(id: number | string, name: string) { updateStage({ projectId: props.project.id, id: Number(id), patch: { name } }, { onError: onApiError }) }
function onFoldStage(id: number | string, fold: boolean) { updateStage({ projectId: props.project.id, id: Number(id), patch: { fold } }, { onError: onApiError }) }
function onReorderStages(ids: (number | string)[]) { reorderStages({ projectId: props.project.id, ids: ids.map(Number) }, { onError: onApiError }) }
function onDeleteStage(id: number | string) {
  deleteStage({ projectId: props.project.id, id: Number(id) }, { onSuccess: () => toast.success(t('projects.stages.deleted')), onError: onApiError })
}
</script>

<template>
  <div data-testid="project-settings-page">
    <SharedFormSection :title="t('projects.settings.tabs.general')">
      <ProjectGeneralForm :project="project" />
    </SharedFormSection>
    <SharedFormSection class="space-y-3" :title="t('projects.settings.tabs.stages')">
      <StageListEditor :stages="sortedStages" :busy="stagesBusy" @add="onAddStage" @rename="onRenameStage" @fold="onFoldStage" @reorder="onReorderStages" @delete="onDeleteStage" />
    </SharedFormSection>
    <SharedFormSection class="space-y-3 pb-0" :title="t('projects.settings.tabs.followers')">
      <FollowerList :project="project" />
    </SharedFormSection>
  </div>
</template>
