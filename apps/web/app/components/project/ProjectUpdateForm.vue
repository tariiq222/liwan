<script setup lang="ts">
import type { ProjectStatus } from '@nasq/contracts'
import { PROJECT_STATUSES } from '@nasq/contracts'
import { toast } from 'vue-sonner'
import DescriptionEditor from '@/components/task/DescriptionEditor.vue'
import { PROJECT_STATUS_LABEL_KEY } from '@/composables/projectStatus'
import { ApiError } from '@/composables/useApi'
import { useCreateProjectUpdate } from '@/composables/useProjectUpdates'
import { isDirtySnapshot } from '@/lib/formDirty'

const props = defineProps<{ projectId: number }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync, isPending } = useCreateProjectUpdate()
const descriptionEditor = ref<{ flush: () => void } | null>(null)
const status = ref<ProjectStatus | undefined>()
const title = ref('')
const description = ref('')
const error = ref<string | null>(null)
const submitted = ref(false)
const baseline = ref(JSON.stringify([undefined, '', '']))

function state() {
  return JSON.stringify([status.value, title.value, description.value])
}

const dirty = computed(() => isDirtySnapshot(baseline.value, state(), submitted.value))

function onDescriptionChange({ html }: { html: string; taskId: number }) {
  description.value = html
}
function onDescriptionDraft({ html }: { html: string; taskId: number }) {
  description.value = html
}
async function submit() {
  error.value = null
  descriptionEditor.value?.flush()
  const name = title.value.trim()
  if (!hydrated.value || !status.value || !name || isPending.value) return
  try {
    await mutateAsync({ projectId: props.projectId, body: { status: status.value, name, description: description.value } })
    submitted.value = true
    toast.success(t('projects.updates.posted'))
    emit('saved')
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <form data-testid="project-update-form" class="nasq-form-grid" @submit.prevent="submit">
    <div class="grid gap-2">
      <Label for="project-update-status">{{ t('projects.updates.status') }}</Label>
      <Select :model-value="status" :disabled="!hydrated || isPending" @update:model-value="(v) => (status = v as ProjectStatus)">
        <SelectTrigger id="project-update-status" class="w-full"><SelectValue :placeholder="t('projects.updates.status')" /></SelectTrigger>
        <SelectContent><SelectItem v-for="s in PROJECT_STATUSES" :key="s" :value="s">{{ t(PROJECT_STATUS_LABEL_KEY[s]) }}</SelectItem></SelectContent>
      </Select>
    </div>
    <div class="grid gap-2">
      <Label for="project-update-title">{{ t('projects.updates.title') }}</Label>
      <Input id="project-update-title" v-model="title" required :disabled="!hydrated || isPending" />
    </div>
    <div class="grid gap-2 sm:col-span-2">
      <Label>{{ t('projects.updates.body') }}</Label>
      <DescriptionEditor ref="descriptionEditor" :model-value="description" :task-id="projectId" :readonly="isPending" @update:model-value="onDescriptionChange" @draft="onDescriptionDraft" />
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive sm:col-span-2">{{ error }}</p>
    <div class="nasq-form-footer justify-end sm:col-span-2">
      <Button type="button" variant="outline" :disabled="isPending" @click="emit('cancel')">{{ t('app.cancel') }}</Button>
      <Button type="submit" :disabled="!hydrated || isPending || !status || !title.trim()">{{ t('app.create') }}</Button>
    </div>
  </form>
</template>
