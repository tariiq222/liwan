<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { usePeople } from '@/composables/usePeople'
import { usePostComment, useThreadTasks } from '@/composables/useTimeline'
import { activeCommentTrigger, declaredReferences, insertCommentReference, type CommentReference } from '@/utils/commentReferences'

const props = defineProps<{ taskId: number }>()

const { t } = useI18n()
const { mutate: postComment, isPending } = usePostComment()
const hydrated = useHydrated()
const toast = useToast()

const body = ref('')

// --- references: `@` a person, `/` a task of this conversation --------------
// The textarea stays plain text. A picked suggestion writes `@name` / `/name`
// into it and is remembered here; on submit only the references whose token is
// still in the text are declared, and the server turns those into markup.
const picked = ref<CommentReference[]>([])
const trigger = ref<ReturnType<typeof activeCommentTrigger>>(null)
const activeIndex = ref(0)
let field: HTMLTextAreaElement | null = null

const personQuery = computed(() => (trigger.value?.kind === 'person' ? trigger.value.query : ''))
const { data: people } = usePeople(personQuery, computed(() => trigger.value?.kind === 'person'))
const taskIdRef = computed(() => props.taskId)
const { data: threadTasks } = useThreadTasks(taskIdRef, computed(() => trigger.value?.kind === 'task'))

const suggestions = computed<CommentReference[]>(() => {
  const current = trigger.value
  if (!current) return []
  if (current.kind === 'person') return (people.value ?? []).slice(0, 8).map(person => ({ kind: 'person', id: person.id, label: person.name }))
  const q = current.query.trim().toLocaleLowerCase()
  return (threadTasks.value ?? [])
    .filter(task => !q || task.name.toLocaleLowerCase().includes(q))
    .slice(0, 8)
    .map(task => ({ kind: 'task', id: task.id, label: task.name }))
})
const menuOpen = computed(() => !!trigger.value && !(trigger.value.query.includes(' ') && !suggestions.value.length))
const listId = computed(() => `task-comment-suggestions-${props.taskId}`)
const activeOptionId = computed(() => (suggestions.value.length ? `${listId.value}-${activeIndex.value}` : undefined))
watch(suggestions, () => { activeIndex.value = 0 })

function syncTrigger(event: Event) {
  field = event.target as HTMLTextAreaElement
  const next = activeCommentTrigger(field.value, field.selectionStart ?? field.value.length)
  // Text typed after an already picked `@name` / `/name` is prose, not a new search.
  const settled = next && picked.value.some(item => item.kind === next.kind && next.query.startsWith(item.label))
  trigger.value = settled ? null : next
}

function pick(reference: CommentReference) {
  const current = trigger.value
  if (!current) return
  const next = insertCommentReference(body.value, current, reference)
  body.value = next.text
  if (!picked.value.some(item => item.kind === reference.kind && item.id === reference.id)) picked.value.push(reference)
  trigger.value = null
  nextTick(() => {
    field?.focus()
    field?.setSelectionRange(next.caret, next.caret)
  })
}

function submit() {
  const text = body.value.trim()
  if (!text || isPending.value) return
  const { mentions, taskRefs } = declaredReferences(text, picked.value)
  postComment(
    { id: props.taskId, body: text, mentions, taskRefs },
    {
      onSuccess: () => {
        body.value = ''
        picked.value = []
        trigger.value = null
      },
      onError: (err) => {
        toast.add({ title: err instanceof ApiError ? err.message : t('errors.generic'), color: 'error' })
      },
    },
  )
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    submit()
    return
  }
  if (!menuOpen.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    trigger.value = null
    return
  }
  const count = suggestions.value.length
  if (!count) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + (e.key === 'ArrowDown' ? 1 : count - 1)) % count
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    pick(suggestions.value[activeIndex.value]!)
  }
}
</script>

<template>
  <form class="mt-4 grid gap-2 border-t border-default pt-3.5" @submit.prevent="submit">
    <UFormField :label="t('tasks.activity.add')" :name="`task-comment-${props.taskId}`" :help="t('tasks.activity.referenceHint')" class="text-xs font-medium">
      <div>
        <UTextarea
          :id="`task-comment-${props.taskId}`"
          v-model="body"
          :placeholder="t('tasks.activity.write')"
          :disabled="!hydrated || isPending"
          class="min-h-22 w-full resize-none"
          aria-autocomplete="list"
          :aria-controls="menuOpen ? listId : undefined"
          :aria-activedescendant="menuOpen ? activeOptionId : undefined"
          @keydown="onKeydown"
          @input="syncTrigger"
          @click="syncTrigger"
          @keyup="syncTrigger"
          @blur="trigger = null"
        />
        <!-- In flow, not floating: the task card clips overflow, and the composer is the last thing in it. -->
        <div
          v-if="menuOpen && trigger"
          data-testid="comment-suggestions"
          class="mt-1 overflow-hidden rounded-md bg-default ring ring-default"
        >
          <p class="border-b border-default px-3 py-1.5 text-xs font-medium text-muted">{{ t(trigger.kind === 'person' ? 'tasks.activity.mentionPerson' : 'tasks.activity.referenceTask') }}</p>
          <ul v-if="suggestions.length" :id="listId" role="listbox" :aria-label="t(trigger.kind === 'person' ? 'tasks.activity.mentionPerson' : 'tasks.activity.referenceTask')" class="max-h-56 overflow-y-auto p-1">
            <li
              v-for="(item, index) in suggestions"
              :id="`${listId}-${index}`"
              :key="`${item.kind}-${item.id}`"
              role="option"
              :aria-selected="index === activeIndex"
              class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-normal text-default"
              :class="index === activeIndex ? 'bg-elevated text-highlighted' : ''"
              @mousedown.prevent="pick(item)"
              @mousemove="activeIndex = index"
            >
              <UIcon :name="item.kind === 'person' ? 'i-lucide-at-sign' : 'i-lucide-list-tree'" class="size-4 shrink-0 text-dimmed" aria-hidden="true" />
              <span class="min-w-0 truncate">{{ item.label }}</span>
            </li>
          </ul>
          <p v-else class="px-3 py-2 text-sm font-normal text-muted">{{ t(trigger.kind === 'person' ? 'tasks.activity.noPeople' : 'tasks.activity.noThreadTasks') }}</p>
        </div>
      </div>
    </UFormField>
    <div class="flex justify-end">
      <UButton type="submit" size="sm" :loading="isPending" :disabled="!hydrated || isPending || !body.trim()">
        {{ t('tasks.activity.post') }}
      </UButton>
    </div>
  </form>
</template>
