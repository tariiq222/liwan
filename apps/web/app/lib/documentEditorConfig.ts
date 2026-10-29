import StarterKit from '@tiptap/starter-kit'

/** StarterKit already ships the link mark; configuring it here avoids registering a second `link` extension. */
export function documentEditorExtensions() {
  return [StarterKit.configure({ link: { openOnClick: false } })]
}

/** An untouched editor reports an empty paragraph; the body model keeps it as the empty string so it is not a change. */
export function documentEditorBody(editor: { isEmpty: boolean; getHTML: () => string }) {
  return editor.isEmpty ? '' : editor.getHTML()
}
