<script setup lang="ts">
import Link from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'
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
      'aria-label': t('documents.body'),
      'aria-multiline': 'true',
      class: 'tiptap min-h-40 px-3 py-2 text-sm outline-none',
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
  if (props.disabled) return
  editor.value?.chain().focus().toggleBold().run()
}
function toggleItalic() {
  if (props.disabled) return
  editor.value?.chain().focus().toggleItalic().run()
}
function toggleBulletList() {
  if (props.disabled) return
  editor.value?.chain().focus().toggleBulletList().run()
}
function toggleOrderedList() {
  if (props.disabled) return
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
    <div data-editor="document" class="overflow-hidden rounded-control bg-default ring ring-default" @keydown.esc.capture="emit('escape')">
      <div class="flex items-center gap-1 border-b border-default p-1">
        <UButton :color="editor?.isActive('bold') ? 'primary' : 'secondary'" variant="ghost" square type="button" :disabled="disabled" :aria-pressed="!!editor?.isActive('bold')" :aria-label="t('documents.format.bold')" icon="i-lucide-bold" @click="toggleBold" />
        <UButton :color="editor?.isActive('italic') ? 'primary' : 'secondary'" variant="ghost" square type="button" :disabled="disabled" :aria-pressed="!!editor?.isActive('italic')" :aria-label="t('documents.format.italic')" icon="i-lucide-italic" @click="toggleItalic" />
        <UButton :color="editor?.isActive('bulletList') ? 'primary' : 'secondary'" variant="ghost" square type="button" :disabled="disabled" :aria-pressed="!!editor?.isActive('bulletList')" :aria-label="t('documents.format.bulletList')" icon="i-lucide-list" @click="toggleBulletList" />
        <UButton :color="editor?.isActive('orderedList') ? 'primary' : 'secondary'" variant="ghost" square type="button" :disabled="disabled" :aria-pressed="!!editor?.isActive('orderedList')" :aria-label="t('documents.format.orderedList')" icon="i-lucide-list-ordered" @click="toggleOrderedList" />
        <UButton :color="editor?.isActive('link') ? 'primary' : 'secondary'" variant="ghost" square type="button" :disabled="disabled" :aria-pressed="!!editor?.isActive('link')" :aria-label="t('documents.format.linkPrompt')" icon="i-lucide-link" @click="toggleLink" />
      </div>
      <div v-if="linkEditing" class="flex gap-2 border-b border-default p-2">
        <UInput v-model="linkUrl" class="flex-1" :disabled="disabled" :aria-label="t('documents.linkPrompt')" :placeholder="t('documents.linkPrompt')" />
        <UButton type="button" color="primary" size="sm" :disabled="disabled" :label="t('app.save')" @click="applyLink" />
        <UButton type="button" color="neutral" variant="outline" size="sm" :label="t('app.cancel')" @click="linkEditing = false" />
      </div>
      <EditorContent :editor="editor" />
    </div>
    <template #fallback>
      <USkeleton class="h-40 w-full" />
    </template>
  </ClientOnly>
</template>
