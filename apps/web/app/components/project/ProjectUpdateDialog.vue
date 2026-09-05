<script setup lang="ts">
import type { ProjectStatus } from '@nasq/contracts'
import { PROJECT_STATUSES } from '@nasq/contracts'
import { toast } from 'vue-sonner'
import DescriptionEditor from '@/components/task/DescriptionEditor.vue'
import { PROJECT_STATUS_LABEL_KEY } from '@/composables/projectStatus'
import { ApiError } from '@/composables/useApi'
import { useCreateProjectUpdate } from '@/composables/useProjectUpdates'

const props = defineProps<{ open: boolean; projectId: number }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync, isPending } = useCreateProjectUpdate()

const status = ref<ProjectStatus | undefined>(undefined)
const title = ref('')
const description = ref('')
const error = ref<string | null>(null)

// Re-seed every time the dialog opens rather than on mount — same instance
// stays alive (v-model'd child of ProjectUpdateList) across multiple opens,
// same reasoning as CreateTaskDialog/CreateProjectDialog.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    status.value = undefined
    title.value = ''
    description.value = ''
    error.value = null
  },
)

function onDescriptionChange({ html }: { html: string; taskId: number }) {
  description.value = html
}

async function submit() {
  error.value = null
  const name = title.value.trim()
  if (!status.value || !name) return
  try {
    await mutateAsync({ projectId: props.projectId, body: { status: status.value, name, description: description.value } })
    toast.success(t('projects.updates.posted'))
    emit('update:open', false)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('projects.updates.new') }}</DialogTitle>
      </DialogHeader>
      <form class="grid gap-4" @submit.prevent="submit">
        <div class="grid gap-2">
          <Label for="project-update-status">{{ t('projects.updates.status') }}</Label>
          <Select :model-value="status" :disabled="!hydrated || isPending" @update:model-value="(v) => (status = v as ProjectStatus)">
            <SelectTrigger id="project-update-status" class="w-full">
              <SelectValue :placeholder="t('projects.updates.status')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="s in PROJECT_STATUSES" :key="s" :value="s">{{ t(PROJECT_STATUS_LABEL_KEY[s]) }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="grid gap-2">
          <Label for="project-update-title">{{ t('projects.updates.title') }}</Label>
          <Input id="project-update-title" v-model="title" required :disabled="!hydrated || isPending" />
        </div>
        <div class="grid gap-2">
          <Label>{{ t('projects.updates.body') }}</Label>
          <DescriptionEditor :model-value="description" :task-id="projectId" @update:model-value="onDescriptionChange" />
        </div>
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
        <DialogFooter>
          <Button type="submit" :disabled="!hydrated || isPending || !status || !title.trim()">{{ t('app.create') }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
