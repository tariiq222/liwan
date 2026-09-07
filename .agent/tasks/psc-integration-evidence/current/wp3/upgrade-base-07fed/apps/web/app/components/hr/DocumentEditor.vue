<script setup lang="ts">
import Link from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { Bold, Italic, Link as LinkIcon, List, ListOrdered } from '@lucide/vue'
import { createDebouncedFlush } from '@/lib/debouncedFlush'
import { shouldApplyDocumentBodyModel } from '@/lib/documentEditorDraft'

const props = withDefaults(defineProps<{ modelValue: string; documentId: number; debounce?: boolean; disabled?: boolean }>(), { debounce: true, disabled: false })
const emit = defineEmits<{ 'update:modelValue': [string, number]; escape: [] }>()

const { t } = useI18n()
const linkEditing = ref(false)
const linkUrl = ref('')

const pendingBodyDraft = ref<string | null>(null)
const buffer = createDebouncedFlush<{ documentId: number; html: string }>(800, ({ html, documentId }) => emit('update:modelValue', html, documentId))

const editor = useEditor({
  content: props.modelValue,
  editable: !props.disabled,
  extensions: [StarterKit, Link.configure({ openOnClick: false })],
  editorProps: {
    attributes: {
      role: 'textbox',
      'aria-label': t('hr.docs.body'),
      'aria-multiline': 'true',
      class: 'tiptap min-h-[160px] px-3 py-2 text-sm outline-none',
    },
  },
  onUpdate: ({ editor: ed }) => {
    const html = ed.getHTML()
    pendingBodyDraft.value = html
    if (props.debounce) buffer.schedule({ documentId: props.documentId, html })
    else emit('update:modelValue', html, props.documentId)
  },
})
watch(() => props.disabled, (disabled) => editor.value?.setEditable(!disabled))

watch(
  () => props.modelValue,
  (html) => {
    if (!editor.value) return
    const editorHtml = editor.value.getHTML()
    if (!shouldApplyDocumentBodyModel(editorHtml, html, pendingBodyDraft.value)) return
    if (html === pendingBodyDraft.value) pendingBodyDraft.value = null
    if (editorHtml === html) return
    editor.value.commands.setContent(html, { emitUpdate: false })
  },
)

watch(
  () => props.documentId,
  () => { buffer.flush(); pendingBodyDraft.value = null },
  { flush: 'pre' },
)

onBeforeUnmount(() => {
  buffer.flush()
  editor.value?.destroy()
})

function toggleBold() {
  editor.value?.chain().focus().toggleBold().run()
}
function toggleItalic() {
  editor.value?.chain().focus().toggleItalic().run()
}
function toggleBulletList() {
  editor.value?.chain().focus().toggleBulletList().run()
}
function toggleOrderedList() {
  editor.value?.chain().focus().toggleOrderedList().run()
}
function toggleLink() {
  if (props.disabled) return
  linkUrl.value = (editor.value?.getAttributes('link').href as string | undefined) ?? ''
  linkEditing.value = true
}
function applyLink() {
  if (props.disabled || !editor.value) return
  const url = linkUrl.value.trim()
  if (!url) editor.value.chain().focus().unsetLink().run()
  else editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  linkEditing.value = false
}

</script>

<template>
  <ClientOnly>
    <!--
      ProseMirror's own keydown handler unconditionally calls
      event.preventDefault() for Escape while the editor has focus (it
      reserves the key for its own future use, regardless of whether any
      command handles it). It does not stopPropagation, so the keydown still
      ProseMirror reserves Escape and prevents the browser default while the
      editor has focus. Keep the capture listener so page-level keyboard
      handling can still observe Escape before it reaches contenteditable.
    -->
    <div class="rounded-lg border border-border/80 bg-card" @keydown.esc.capture="emit('escape')">
      <div class="flex items-center gap-1 border-b p-1">
        <Button variant="ghost" size="icon" class="size-[32px] rounded-lg border border-border" :class="{ 'bg-accent': editor?.isActive('bold') }" type="button" :disabled="disabled" :aria-label="t('tasks.detail.bold')" @click="toggleBold">
          <Bold class="size-[18px]" />
        </Button>
        <Button variant="ghost" size="icon" class="size-[32px] rounded-lg border border-border" :class="{ 'bg-accent': editor?.isActive('italic') }" type="button" :disabled="disabled" :aria-label="t('tasks.detail.italic')" @click="toggleItalic">
          <Italic class="size-[18px]" />
        </Button>
        <Button variant="ghost" size="icon" class="size-[32px] rounded-lg border border-border" :class="{ 'bg-accent': editor?.isActive('bulletList') }" type="button" :disabled="disabled" :aria-label="t('tasks.detail.bulletList')" @click="toggleBulletList">
          <List class="size-[18px]" />
        </Button>
        <Button
          variant="ghost" size="icon" class="size-[32px] rounded-lg border border-border" :class="{ 'bg-accent': editor?.isActive('orderedList') }" type="button" :aria-label="t('tasks.detail.orderedList')"
          @click="toggleOrderedList"
        >
          <ListOrdered class="size-[18px]" />
        </Button>
        <Button variant="ghost" size="icon" class="size-[32px] rounded-lg border border-border" :class="{ 'bg-accent': editor?.isActive('link') }" type="button" :disabled="disabled" :aria-label="t('tasks.detail.linkPrompt')" @click="toggleLink">
          <LinkIcon class="size-[18px]" />
        </Button>
      </div>
      <div v-if="linkEditing" class="flex gap-2 border-b p-2">
        <Input v-model="linkUrl" :disabled="disabled" :aria-label="t('hr.docs.linkPrompt')" :placeholder="t('hr.docs.linkPrompt')" />
        <Button type="button" size="sm" :disabled="disabled" @click="applyLink">{{ t('app.save') }}</Button>
        <Button type="button" size="sm" variant="outline" @click="linkEditing = false">{{ t('app.cancel') }}</Button>
      </div>
      <EditorContent :editor="editor" />
    </div>
    <template #fallback>
      <Skeleton class="h-40 w-full" />
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
  color: var(--primary);
  text-decoration: underline;
}
</style>
