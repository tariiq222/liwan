<script setup lang="ts">
import type { ProjectDetail } from '@nasq/contracts'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useAddStage, useDeleteStage, useReorderStages, useUpdateStage } from '@/composables/useProjectStages'
import FollowerList from './FollowerList.vue'
import ProjectGeneralForm from './ProjectGeneralForm.vue'
import StageListEditor from './StageListEditor.vue'

const props = defineProps<{ open: boolean; project: ProjectDetail }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const { t } = useI18n()
const hydrated = useHydrated()

const { mutate: addStage, isPending: adding } = useAddStage()
const { mutate: updateStage, isPending: updating } = useUpdateStage()
const { mutate: reorderStages, isPending: reordering } = useReorderStages()
const { mutate: deleteStage, isPending: deleting } = useDeleteStage()

// One shared busy flag: any in-flight stage mutation disables the whole
// editor rather than just its own row, since add/rename/fold/reorder/delete
// all invalidate and refetch the same project detail query.
const stagesBusy = computed(() => adding.value || updating.value || reordering.value || deleting.value)

const sortedStages = computed(() => [...props.project.stages].sort((a, b) => a.sequence - b.sequence || a.id - b.id))

function onApiError(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
}

function onAddStage(name: string) {
  addStage({ projectId: props.project.id, name }, { onError: onApiError })
}
function onRenameStage(id: number | string, name: string) {
  updateStage({ projectId: props.project.id, id: Number(id), patch: { name } }, { onError: onApiError })
}
function onFoldStage(id: number | string, fold: boolean) {
  updateStage({ projectId: props.project.id, id: Number(id), patch: { fold } }, { onError: onApiError })
}
function onReorderStages(ids: (number | string)[]) {
  reorderStages({ projectId: props.project.id, ids: ids.map(Number) }, { onError: onApiError })
}
function onDeleteStage(id: number | string) {
  deleteStage(
    { projectId: props.project.id, id: Number(id) },
    { onSuccess: () => toast.success(t('projects.stages.deleted')), onError: onApiError },
  )
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent data-testid="project-settings-dialog" class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ t('projects.settings.title') }}</DialogTitle>
      </DialogHeader>

      <Tabs default-value="general">
        <TabsList>
          <TabsTrigger value="general" :disabled="!hydrated">{{ t('projects.settings.tabs.general') }}</TabsTrigger>
          <TabsTrigger value="stages" :disabled="!hydrated">{{ t('projects.settings.tabs.stages') }}</TabsTrigger>
          <TabsTrigger value="followers" :disabled="!hydrated">{{ t('projects.settings.tabs.followers') }}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" class="max-h-[60vh] overflow-y-auto py-2">
          <ProjectGeneralForm :project="project" />
        </TabsContent>

        <TabsContent value="stages" class="max-h-[60vh] overflow-y-auto py-2">
          <StageListEditor
            :stages="sortedStages"
            :busy="stagesBusy"
            @add="onAddStage"
            @rename="onRenameStage"
            @fold="onFoldStage"
            @reorder="onReorderStages"
            @delete="onDeleteStage"
          />
        </TabsContent>

        <TabsContent value="followers" class="max-h-[60vh] overflow-y-auto py-2">
          <FollowerList :project="project" />
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
</template>
