<script setup lang="ts">
import { nextTick } from 'vue'
import type { TaskDetail } from '@liwan/contracts'
import { useUpdateTask } from '@/composables/useTasks'
import { isDirtySnapshot } from '@/lib/formDirty'
import { richTextHasContent } from '@/utils/richText'
import { sanitizeHtml } from '@liwan/ui/app/utils/sanitize'
import DescriptionEditor from '@/components/shared/form/DescriptionEditor.vue'

const props = defineProps<{ task: TaskDetail }>()

const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync, isPending } = useUpdateTask({ notifyErrors: false })

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

// The read view is a click target for pointers; keyboard users reach the same action through a button that
// shows on focus. Focus goes back to whichever of them exists once the editor closes.
const TRIGGER_ID = 'task-description-trigger'
function focusTrigger() {
  if (typeof document !== 'undefined') void nextTick(() => document.getElementById(TRIGGER_ID)?.focus())
}

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
  focusTrigger()
}

// Clicking the text opens the editor; clicking a link inside it follows the link.
function onReadClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a')) return
  startEdit()
}

// Leaving the editor (not its toolbar or link field) saves; Escape cancels; Ctrl/Cmd+Enter saves and keeps focus.
function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  if (next && (event.currentTarget as HTMLElement).contains(next)) return
  void save()
}

function onEditorKeydown(event: KeyboardEvent) {
  // The rich-text editor itself consumes Escape (it marks the event handled), so Escape is read before that mark is.
  if (event.defaultPrevented && event.key !== 'Escape') return
  if (event.key === 'Escape') {
    // The link field closes itself on Escape; the description stays open.
    if ((event.target as HTMLElement).closest('[data-testid="link-editor"]')) return
    event.preventDefault()
    event.stopPropagation()
    cancelEdit()
  } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    void save().then(focusTrigger)
  }
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
  // Leaving the editor untouched is a close, not a write.
  if (!dirty.value) {
    resetReadView(props.task.description_html)
    return
  }
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
    toast.add({ title: t('tasks.descriptionField.saved'), color: 'success' })
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

  <section data-testid="task-description" :aria-label="t('tasks.drawer.description')" class="grid min-w-0 gap-2">
    <template v-if="!editing">
      <template v-if="hasDescription">
        <div
          class="-mx-2 rounded-inner px-2 py-1 transition-colors motion-reduce:transition-none"
          :class="task.can_write && hydrated ? 'cursor-text hover:bg-elevated/60' : ''"
          @click="onReadClick"
        >
          <SharedRichText :html="renderedHtml" size="sm" />
        </div>
        <button
          v-if="task.can_write"
          :id="TRIGGER_ID"
          type="button"
          data-testid="task-description-edit"
          class="sr-only focus:not-sr-only focus:w-fit focus:rounded-inner focus:px-2 focus:py-1 focus:text-xs focus:text-muted focus-visible:outline-2 focus-visible:outline-primary"
          :disabled="!hydrated || isPending"
          @click="startEdit"
        >{{ t('tasks.descriptionField.edit') }}</button>
      </template>
      <button
        v-else-if="task.can_write"
        :id="TRIGGER_ID"
        type="button"
        data-testid="task-description-add"
        class="-mx-2 w-fit rounded-inner px-2 py-1 text-start text-sm text-muted transition-colors hover:bg-elevated/60 hover:text-default focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none"
        :disabled="!hydrated || isPending"
        @click="startEdit"
      >{{ t('tasks.descriptionField.add') }}</button>
      <p v-else data-testid="task-description-empty" class="text-sm text-muted">{{ t('tasks.descriptionField.empty') }}</p>
    </template>

    <form v-else class="liwan-form" data-testid="task-description-editor" @submit.prevent="save" @focusout="onFocusOut" @keydown="onEditorKeydown">
      <DescriptionEditor
        :model-value="editorInitialHtml"
        :task-id="editTaskId!"
        autofocus
        :readonly="isPending || !task.can_write"
        @draft="onDescriptionDraft"
      />
      <p v-if="error" role="alert" data-testid="task-description-error" class="text-sm text-error">{{ error }}</p>
      <p role="status" aria-live="polite" class="text-xs text-muted">{{ isPending ? t('tasks.descriptionField.saving') : t('tasks.descriptionField.hint') }}</p>
    </form>
  </section>
</template>
