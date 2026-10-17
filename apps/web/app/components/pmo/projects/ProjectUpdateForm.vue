<script setup lang="ts">
import DescriptionEditor from '@/components/shared/form/DescriptionEditor.vue'
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
const attempted = ref(false)
const requiredError = computed(() => attempted.value && !title.value.trim() ? t('projects.updates.titleRequired') : undefined)
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
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = null
  descriptionEditor.value?.flush()
  const name = title.value.trim()
  if (!name) return
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
  <form novalidate data-testid="project-update-form" class="grid gap-(--webvue-card-pad)" @submit.prevent="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />
    <UFormField :label="t('projects.updates.title')" required :error="requiredError">
      <UInput id="project-update-title" v-model="title" class="w-full" required :disabled="!hydrated || isPending" />
    </UFormField>
    <UFormField :label="t('projects.updates.body')">
      <DescriptionEditor ref="descriptionEditor" :model-value="description" :task-id="projectId" :readonly="isPending" @update:model-value="onDescriptionChange" @draft="onDescriptionDraft" />
    </UFormField>
    <SharedFormActions>
      <UButton type="button" color="neutral" :disabled="isPending" :label="t('app.cancel')" @click="emit('cancel')" variant="outline" />
      <UButton type="submit" :disabled="!hydrated || isPending" :loading="isPending" :label="t('projects.updates.publish')" />
    </SharedFormActions>
  </form>
</template>
