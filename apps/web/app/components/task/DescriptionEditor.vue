<script setup lang="ts">
import Link from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { Bold, Italic, Link as LinkIcon, List, ListOrdered } from '@lucide/vue'
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
      class: 'tiptap min-h-[80px] px-3 py-2 text-sm outline-none',
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
    <div class="rounded-md border">
      <div v-if="!readonly" class="flex items-center gap-1 border-b p-1">
        <Button variant="ghost" size="icon" class="size-[32px] rounded-lg" :disabled="!hydrated" :aria-label="t('tasks.detail.bold')" :class="{ 'bg-accent': editor?.isActive('bold') }" type="button" @click="toggleBold">
          <Bold class="size-[18px]" />
        </Button>
        <Button variant="ghost" size="icon" class="size-[32px] rounded-lg" :disabled="!hydrated" :aria-label="t('tasks.detail.italic')" :class="{ 'bg-accent': editor?.isActive('italic') }" type="button" @click="toggleItalic">
          <Italic class="size-[18px]" />
        </Button>
        <Button variant="ghost" size="icon" class="size-[32px] rounded-lg" :disabled="!hydrated" :aria-label="t('tasks.detail.bulletList')" :class="{ 'bg-accent': editor?.isActive('bulletList') }" type="button" @click="toggleBulletList">
          <List class="size-[18px]" />
        </Button>
        <Button
          variant="ghost" size="icon" class="size-[32px] rounded-lg" :aria-label="t('tasks.detail.orderedList')" :class="{ 'bg-accent': editor?.isActive('orderedList') }" type="button"
          :disabled="!hydrated" @click="toggleOrderedList"
        >
          <ListOrdered class="size-[18px]" />
        </Button>
        <Button variant="ghost" size="icon" class="size-[32px] rounded-lg" :disabled="!hydrated" :aria-label="t('tasks.detail.linkPrompt')" :class="{ 'bg-accent': editor?.isActive('link') }" type="button" @click="toggleLink">
          <LinkIcon class="size-[18px]" />
        </Button>
      </div>
      <div v-if="linkEditorOpen" data-testid="link-editor" class="flex flex-wrap items-center gap-2 border-b p-2">
        <Label for="description-link-url" class="sr-only">{{ t('tasks.detail.linkPrompt') }}</Label>
        <Input id="description-link-url" v-model="linkDraft" :placeholder="t('tasks.detail.linkPrompt')" class="min-w-48 flex-1" dir="ltr" :disabled="!hydrated || readonly" @keydown.enter.prevent="applyLink" @keydown.escape="cancelLink" />
        <Button type="button" size="sm" :disabled="!hydrated || readonly" @click="applyLink">{{ t('tasks.detail.applyLink') }}</Button>
        <Button type="button" size="sm" variant="ghost" @click="cancelLink">{{ t('tasks.detail.cancelLink') }}</Button>
      </div>
      <EditorContent :editor="editor" />
    </div>
    <template #fallback>
      <Skeleton class="h-28 w-full" />
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
