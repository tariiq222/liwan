import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import * as inlineEdit from '../../../../utils/inlineEdit'
import { renderShared, type SharedRenderOptions } from '../../../../../test/helpers/renderShared'

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
})
