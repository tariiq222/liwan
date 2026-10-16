<script setup lang="ts">
import type { TaskDetail } from '@webvue/contracts'
import { useUpdateTask } from '@/composables/useTasks'
import { isDirtySnapshot } from '@/lib/formDirty'
import { richTextHasContent } from '@/utils/richText'
import { sanitizeHtml } from '@webvue/ui/app/utils/sanitize'
import DescriptionEditor from '@/components/shared/form/DescriptionEditor.vue'

const props = defineProps<{ task: TaskDetail }>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync, isPending } = useUpdateTask()

const editing = ref(false)
const draft = ref(props.task.description_html)
const baseline = ref(props.task.description_html)
const editorInitialHtml = ref(props.task.description_html)
const readHtml = ref(props.task.description_html)
const editTaskId = ref<number | null>(null)
const error = ref<string | null>(null)
let editSession = 0

const renderedHtml = computed(() => sanitizeHtml(readHtml.value))
const hasDescription = computed(() => richTextHasContent(readHtml.value))
const dirty = computed(() => editing.value && isDirtySnapshot(baseline.value, draft.value, false))

function resetReadView(html: string) {
  editSession += 1
  editing.value = false
  editTaskId.value = null
  error.value = null
  readHtml.value = html
  draft.value = html
  baseline.value = html
  editorInitialHtml.value = html
}

function startEdit() {
  if (!hydrated.value || !props.task.can_write || isPending.value) return
  editSession += 1
  editTaskId.value = props.task.id
  error.value = null
  draft.value = props.task.description_html
  baseline.value = props.task.description_html
  editorInitialHtml.value = props.task.description_html
  editing.value = true
}

function cancelEdit() {
  if (isPending.value) return
  resetReadView(props.task.description_html)
}

function onDescriptionDraft({ html, taskId }: { html: string; taskId: number }) {
  if (!editing.value || taskId !== editTaskId.value || taskId !== props.task.id) return
  draft.value = html
  error.value = null
}

async function save() {
  if (!hydrated.value || !editing.value || !props.task.can_write || isPending.value) return
  const taskId = editTaskId.value
  if (taskId === null) return
  const session = editSession
  const html = draft.value
  error.value = null

  try {
    const saved = await mutateAsync({ id: taskId, patch: { description: html } })
    // A route update or a permission revocation can finish this component's
    // edit session while the request is in flight. Its result belongs to the
    // captured task only, so never let it reopen or reset a newer view.
    if (session !== editSession || taskId !== props.task.id || !editing.value) return
    const persisted = saved.description_html
    resetReadView(persisted)
  } catch {
    if (session !== editSession || taskId !== props.task.id || !editing.value) return
    error.value = t('tasks.descriptionField.saveError')
  }
}

watch(() => props.task.id, () => resetReadView(props.task.description_html))

watch(() => props.task.description_html, (html) => {
  // While editing, the optimistic cache update and a refetch must not replace
  // the user's local draft or reset the editor selection.
  if (editing.value) return
  readHtml.value = html
  draft.value = html
  baseline.value = html
  editorInitialHtml.value = html
})

watch(() => props.task.can_write, (canWrite) => {
  if (!canWrite && editing.value) resetReadView(props.task.description_html)
})
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" :guard-route-updates="true" />

  <div data-testid="task-description" class="grid gap-3">
    <div v-if="!editing">
      <div class="flex items-start justify-between gap-3">
        <SharedRichText v-if="hasDescription" :html="renderedHtml" size="sm" class="flex-1" />
        <p v-else data-testid="task-description-empty" class="text-sm text-muted">{{ t('tasks.descriptionField.empty') }}</p>
        <UButton
          v-if="task.can_write"
          data-testid="task-description-edit"
          color="neutral" variant="outline"
          size="sm"
          type="button"
          :disabled="!hydrated || isPending"
          @click="startEdit"
        >
          {{ hasDescription ? t('tasks.descriptionField.edit') : t('tasks.descriptionField.add') }}
        </UButton>
      </div>
    </div>

    <form v-else class="grid gap-3" data-testid="task-description-editor" @submit.prevent="save">
      <DescriptionEditor
        :model-value="editorInitialHtml"
        :task-id="editTaskId!"
        :readonly="isPending || !task.can_write"
        @draft="onDescriptionDraft"
      />
      <p v-if="error" role="alert" data-testid="task-description-error" class="text-sm text-error">{{ error }}</p>
      <SharedFormActions class="flex flex-wrap justify-end gap-2">
        <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || isPending" @click="cancelEdit">{{ t('tasks.descriptionField.cancel') }}</UButton>
        <UButton type="submit" :loading="isPending" :disabled="!hydrated || isPending">{{ t('tasks.descriptionField.save') }}</UButton>
      </SharedFormActions>
    </form>
  </div>
</template>
