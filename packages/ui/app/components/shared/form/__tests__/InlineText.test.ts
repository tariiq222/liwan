import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import * as inlineEdit from '../../../../utils/inlineEdit'
import { createHostNode, findNode, hostRenderer } from '../../../../../test/helpers/hostRenderer'
import { loadShared, renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

const options: SharedRenderOptions = {
  modules: { '../../../utils/inlineEdit': inlineEdit },
  globals: { useTemplateRef: () => Vue.ref(null) },
}
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

describe('SharedInlineText', () => {
  it('reads as a button named by what it edits, with the value as its content', async () => {
    const html = clean(await renderShared('InlineText', { modelValue: 'Write the brief', label: 'Edit title' }, {}, options))
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-label="Edit title: Write the brief"[^>]*>Write the brief<\/button>/)
    expect(html).not.toContain('<input')
    expect(html).toContain('aria-live="polite"')
  })

  it('shows the placeholder, muted, when the value is empty', async () => {
    const html = clean(await renderShared('InlineText', { modelValue: '', label: 'Hours', placeholder: 'Not set' }, {}, options))
    expect(html).toContain('text-muted')
    expect(html).toContain('>Not set</button>')
  })

  it('is plain text, not a button, when the record is read-only', async () => {
    const html = clean(await renderShared('InlineText', { modelValue: 'Read only', label: 'Edit title', editable: false }, {}, options))
    expect(html).not.toContain('<button')
    expect(html).toContain('Read only')
  })

  it('disables the button until hydration so a first click is not lost', async () => {
    const html = clean(await renderShared('InlineText', { modelValue: 'Name', label: 'Edit' }, {}, { ...options, hydrated: false }))
    expect(html).toMatch(/<button[^>]*disabled/)
  })

  it.each([
    { draft: 2.5, allowEmpty: false, saved: '2.5' },
    { draft: 0, allowEmpty: false, saved: '0' },
    { draft: 3, allowEmpty: false, saved: null },
    { draft: '', allowEmpty: false, saved: null },
    { draft: '', allowEmpty: true, saved: '' },
  ])('handles a number input draft of $draft with allowEmpty=$allowEmpty', async ({ draft, allowEmpty, saved }) => {
    const onSave = vi.fn()
    const InlineText = loadShared('InlineText', options)
    const UInput = Vue.defineComponent({
      emits: ['update:modelValue', 'blur'],
      setup(_, { emit }) {
        return () => Vue.h('input', {
          onInput: () => emit('update:modelValue', draft),
          onBlur: () => emit('blur'),
        })
      },
    })
    const root = createHostNode()
    const app = hostRenderer.createApp(InlineText, { modelValue: '3', label: 'Hours', type: 'number', allowEmpty, onSave })
    app.component('UInput', UInput)
    app.mount(root)
    try {
      const button = findNode(root, node => node.type === 'button')!
      const onClick = button.props.onClick as () => void
      onClick()
      await Vue.nextTick()
      const input = findNode(root, node => node.type === 'input')!
      const { onInput, onBlur } = input.props as { onInput: () => void; onBlur: () => void }
      onInput()
      onBlur()
      expect(onSave.mock.calls).toEqual(saved === null ? [] : [[saved]])
    } finally {
      app.unmount()
    }
  })
})
