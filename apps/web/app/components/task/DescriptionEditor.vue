<script setup lang="ts">
import Link from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { createDebouncedFlush } from '@/lib/debouncedFlush'

// Tiptap StarterKit + Link, rendered client-only (SSR has no DOM for
// ProseMirror). Round-trips Odoo HTML: modelValue is the field's raw HTML,
// and every change is pushed back out debounced 800ms via getHTML().
//
// `taskId` identifies which task the current `modelValue`/edits belong to.
// Vue Router/Nuxt can reuse this component instance across a /tasks/A ->
// /tasks/B navigation (same component at the same position in the tree), so
// a pending debounced edit from A must not survive to fire 800ms later
// against B — see flush() below and the parent's :key="task.id", which is
// belt-and-braces with this fix, not a replacement for it.
const props = defineProps<{ modelValue: string; taskId: number; readonly?: boolean; ariaLabel?: string }>()
const emit = defineEmits<{
  'update:modelValue': [{ html: string; taskId: number }]
  draft: [{ html: string; taskId: number }]
}>()

const { t } = useI18n()
const hydrated = useHydrated()

const buffer = createDebouncedFlush<{ html: string; taskId: number }>(800, (value) => emit('update:modelValue', value))

const editor = useEditor({
  content: props.modelValue,
  editable: !props.readonly,
  extensions: [StarterKit.configure({ link: false }), Link.configure({ openOnClick: false })],
  editorProps: {
    attributes: {
      role: 'textbox',
      'aria-label': props.ariaLabel || t('tasks.drawer.description'),
      'aria-multiline': 'true',
      class: 'tiptap min-h-20 px-3 py-2 text-sm outline-none',
    },
  },
  onUpdate: ({ editor: ed }) => {
    // Capture the task this edit belongs to at schedule time, not read it
    // later from (possibly-by-then-stale) props — so flush() always emits
    // against the right task regardless of when it actually runs.
    if (!props.readonly) {
      const draft = { html: ed.getHTML(), taskId: props.taskId }
      // Explicit-submit forms need the current draft for their dirty guard;
      // the update event remains debounced for autosaving consumers.
      emit('draft', draft)
      buffer.schedule(draft)
    }
  },
})

// Reflect out-of-band changes (server response after another edit, or a
// prev/next navigation that swaps the underlying task) without clobbering
// text the user is actively typing.
watch(
  () => props.modelValue,
  (html) => {
    if (!editor.value || editor.value.getHTML() === html) return
    editor.value.commands.setContent(html, { emitUpdate: false })
  },
)

// Belt-and-braces with the parent's :key="task.id" (which normally makes
// this whole component remount on task change, hitting onBeforeUnmount
// below instead): if this instance is ever reused across a task change
// anyway, flush the pending edit *before* it starts rendering the new task.
watch(
  () => props.taskId,
  () => buffer.flush(),
  { flush: 'pre' },
)

onBeforeUnmount(() => {
  buffer.flush()
  editor.value?.destroy()
})

function flush() {
  buffer.flush()
}

defineExpose({ flush })

function toggleBold() {
  if (props.readonly) return
  editor.value?.chain().focus().toggleBold().run()
}
function toggleItalic() {
  if (props.readonly) return
  editor.value?.chain().focus().toggleItalic().run()
}
function toggleBulletList() {
  if (props.readonly) return
  editor.value?.chain().focus().toggleBulletList().run()
}
function toggleOrderedList() {
  if (props.readonly) return
  editor.value?.chain().focus().toggleOrderedList().run()
}
watch(() => props.readonly, value => editor.value?.setEditable(!value))
const linkEditorOpen = ref(false)
const linkDraft = ref('')
function toggleLink() {
  if (props.readonly) return
  const previous = editor.value?.getAttributes('link').href as string | undefined
  linkDraft.value = previous ?? ''
  linkEditorOpen.value = true
}
function cancelLink() {
  linkEditorOpen.value = false
}
function applyLink() {
  if (props.readonly) return
  const url = linkDraft.value.trim()
  if (!url) editor.value?.chain().focus().unsetLink().run()
  else editor.value?.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  linkEditorOpen.value = false
}
</script>

<template>
  <ClientOnly>
    <div class="overflow-hidden rounded-lg border border-default bg-default shadow-sm">
      <div v-if="!readonly" class="flex items-center gap-1 border-b border-default bg-elevated/30 p-1">
        <UButton color="neutral" square size="sm" :disabled="!hydrated" :aria-label="t('tasks.detail.bold')" :variant="editor?.isActive('bold') ? 'soft' : 'ghost'" :aria-pressed="!!editor?.isActive('bold')" type="button" @click="toggleBold">
          <UIcon name="i-lucide-bold" class="size-4.5" aria-hidden="true" />
        </UButton>
        <UButton color="neutral" square size="sm" :disabled="!hydrated" :aria-label="t('tasks.detail.italic')" :variant="editor?.isActive('italic') ? 'soft' : 'ghost'" :aria-pressed="!!editor?.isActive('italic')" type="button" @click="toggleItalic">
          <UIcon name="i-lucide-italic" class="size-4.5" aria-hidden="true" />
        </UButton>
        <UButton color="neutral" square size="sm" :disabled="!hydrated" :aria-label="t('tasks.detail.bulletList')" :variant="editor?.isActive('bulletList') ? 'soft' : 'ghost'" :aria-pressed="!!editor?.isActive('bulletList')" type="button" @click="toggleBulletList">
          <UIcon name="i-lucide-list" class="size-4.5" aria-hidden="true" />
        </UButton>
        <UButton
          color="neutral" square size="sm" :aria-label="t('tasks.detail.orderedList')" :variant="editor?.isActive('orderedList') ? 'soft' : 'ghost'" :aria-pressed="!!editor?.isActive('orderedList')" type="button"
          :disabled="!hydrated" @click="toggleOrderedList"
        >
          <UIcon name="i-lucide-list-ordered" class="size-4.5" aria-hidden="true" />
        </UButton>
        <UButton color="neutral" square size="sm" :disabled="!hydrated" :aria-label="t('tasks.detail.linkPrompt')" :variant="editor?.isActive('link') ? 'soft' : 'ghost'" :aria-pressed="!!editor?.isActive('link')" type="button" @click="toggleLink">
          <UIcon name="i-lucide-link" class="size-4.5" aria-hidden="true" />
        </UButton>
      </div>
      <div v-if="linkEditorOpen" data-testid="link-editor" class="flex flex-wrap items-center gap-2 border-b border-default p-2">
        <label for="description-link-url" class="sr-only">{{ t('tasks.detail.linkPrompt') }}</label>
        <UInput id="description-link-url" v-model="linkDraft" :placeholder="t('tasks.detail.linkPrompt')" class="min-w-48 flex-1" dir="ltr" :disabled="!hydrated || readonly" @keydown.enter.prevent="applyLink" @keydown.escape="cancelLink" />
        <UButton type="button" size="sm" :disabled="!hydrated || readonly" @click="applyLink">{{ t('tasks.detail.applyLink') }}</UButton>
        <UButton type="button" size="sm" color="neutral" variant="outline" :disabled="!hydrated" @click="cancelLink">{{ t('tasks.detail.cancelLink') }}</UButton>
      </div>
      <EditorContent :editor="editor" />
    </div>
    <template #fallback>
      <USkeleton class="h-28 w-full" />
    </template>
  </ClientOnly>
</template>

<style scoped>
:deep(.tiptap p) {
  margin: 0 0 0.5em;
}
:deep(.tiptap ul) {
  list-style: disc;
  padding-inline-start: 1.5em;
}
:deep(.tiptap ol) {
  list-style: decimal;
  padding-inline-start: 1.5em;
}
:deep(.tiptap a) {
  color: var(--brand-link);
  text-decoration: underline;
}
</style>
