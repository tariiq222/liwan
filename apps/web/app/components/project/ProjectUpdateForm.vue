<script setup lang="ts">
import DescriptionEditor from '@/components/task/DescriptionEditor.vue'
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
const title = ref('')
const description = ref('')
const error = ref<string | null>(null)
const submitted = ref(false)
const baseline = ref(JSON.stringify(['', '']))

function state() {
  return JSON.stringify([title.value, description.value])
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
  if (!hydrated.value || !name || isPending.value) return
  try {
    await mutateAsync({ projectId: props.projectId, body: { name, description: description.value } })
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
    <UFormField :label="t('projects.updates.title')" required>
      <UInput id="project-update-title" v-model="title" class="w-full" required :disabled="!hydrated || isPending" />
    </UFormField>
    <UFormField class="sm:col-span-2" :label="t('projects.updates.body')">
      <DescriptionEditor ref="descriptionEditor" :model-value="description" :task-id="projectId" :readonly="isPending" @update:model-value="onDescriptionChange" @draft="onDescriptionDraft" />
    </UFormField>
    <p v-if="error" role="alert" class="text-sm text-error sm:col-span-2">{{ error }}</p>
    <div class="flex flex-wrap gap-2 justify-end sm:col-span-2">
      <UButton type="button" color="neutral" :disabled="isPending" :label="t('app.cancel')" @click="emit('cancel')" variant="outline" />
      <UButton type="submit" :disabled="!hydrated || isPending || !title.trim()" :label="t('app.create')" />
    </div>
  </form>
</template>
