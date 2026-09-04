<script setup lang="ts">
import Link from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { Bold, Italic, Link as LinkIcon, List, ListOrdered } from 'lucide-vue-next'

// Tiptap StarterKit + Link, rendered client-only (SSR has no DOM for
// ProseMirror). Round-trips Odoo HTML: modelValue is the field's raw HTML,
// and every change is pushed back out debounced 800ms via getHTML().
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const { t } = useI18n()

let debounceTimer: ReturnType<typeof setTimeout> | undefined

const editor = useEditor({
  content: props.modelValue,
  extensions: [StarterKit, Link.configure({ openOnClick: false })],
  editorProps: {
    attributes: {
      role: 'textbox',
      'aria-label': t('tasks.drawer.description'),
      'aria-multiline': 'true',
      class: 'tiptap min-h-[160px] px-3 py-2 text-sm outline-none',
    },
  },
  onUpdate: ({ editor: ed }) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => emit('update:modelValue', ed.getHTML()), 800)
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

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
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
  const previous = editor.value?.getAttributes('link').href as string | undefined
  // eslint-disable-next-line no-alert
  const url = window.prompt(t('tasks.drawer.description'), previous ?? 'https://')
  if (url === null) return
  if (!url) editor.value?.chain().focus().unsetLink().run()
  else editor.value?.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}
</script>

<template>
  <ClientOnly>
    <div class="rounded-md border">
      <div class="flex items-center gap-1 border-b p-1">
        <Button variant="ghost" size="icon" class="size-7" :class="{ 'bg-accent': editor?.isActive('bold') }" type="button" @click="toggleBold">
          <Bold class="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" class="size-7" :class="{ 'bg-accent': editor?.isActive('italic') }" type="button" @click="toggleItalic">
          <Italic class="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" class="size-7" :class="{ 'bg-accent': editor?.isActive('bulletList') }" type="button" @click="toggleBulletList">
          <List class="size-3.5" />
        </Button>
        <Button
          variant="ghost" size="icon" class="size-7" :class="{ 'bg-accent': editor?.isActive('orderedList') }" type="button"
          @click="toggleOrderedList"
        >
          <ListOrdered class="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" class="size-7" :class="{ 'bg-accent': editor?.isActive('link') }" type="button" @click="toggleLink">
          <LinkIcon class="size-3.5" />
        </Button>
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
