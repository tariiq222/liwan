<script setup lang="ts">
import type { ProjectStatus } from '@nasq/contracts'
import { PROJECT_STATUSES } from '@nasq/contracts'
import DescriptionEditor from '@/components/task/DescriptionEditor.vue'
import { PROJECT_STATUS_LABEL_KEY } from '@/composables/projectStatus'
import { ApiError } from '@/composables/useApi'
import { useCreateProjectUpdate } from '@/composables/useProjectUpdates'
import { isDirtySnapshot } from '@/lib/formDirty'

const props = defineProps<{ projectId: number }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
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
    toast.add({ title: t('projects.updates.posted'), color: 'success' })
    emit('saved')
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <form data-testid="project-update-form" class="grid gap-5" @submit.prevent="submit">
    <div class="grid gap-2">
      <label for="project-update-status" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.updates.status') }}</label>
      <USelect
        id="project-update-status"
        :model-value="status"
        :items="PROJECT_STATUSES.map(s => ({ value: s, label: t(PROJECT_STATUS_LABEL_KEY[s]) }))"
        :placeholder="t('projects.updates.status')"
        :disabled="!hydrated || isPending"
        class="w-full"
        @update:model-value="(v) => (status = v as ProjectStatus)"
      />
    </div>
    <div class="grid gap-2">
      <label for="project-update-title" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.updates.title') }}</label>
      <UInput id="project-update-title" v-model="title" class="w-full" required :disabled="!hydrated || isPending" />
    </div>
    <div class="grid gap-2 sm:col-span-2">
      <span class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.updates.body') }}</span>
      <DescriptionEditor ref="descriptionEditor" :model-value="description" :task-id="projectId" :readonly="isPending" @update:model-value="onDescriptionChange" @draft="onDescriptionDraft" />
    </div>
    <p v-if="error" role="alert" class="text-sm text-error sm:col-span-2">{{ error }}</p>
    <div class="flex flex-wrap gap-2 justify-end sm:col-span-2">
      <UButton type="button" color="secondary" :disabled="isPending" :label="t('app.cancel')" @click="emit('cancel')" variant="solid" />
      <UButton type="submit" :disabled="!hydrated || isPending || !status || !title.trim()" :label="t('app.create')" />
    </div>
  </form>
</template>
