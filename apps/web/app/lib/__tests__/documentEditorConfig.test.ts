import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flattenExtensions } from '@tiptap/core'
import { expect, it } from 'vitest'
import { documentEditorBody, documentEditorExtensions } from '../documentEditorConfig'

it('registers each extension once, so tiptap reports no duplicate link', () => {
  const names = flattenExtensions(documentEditorExtensions()).map(extension => extension.name)
  expect(names.filter(name => name === 'link')).toHaveLength(1)
  expect(new Set(names).size).toBe(names.length)
})
it('keeps an untouched editor as an empty body, not an empty paragraph', () => {
  expect(documentEditorBody({ isEmpty: true, getHTML: () => '<p></p>' })).toBe('')
  expect(documentEditorBody({ isEmpty: false, getHTML: () => '<p>Text</p>' })).toBe('<p>Text</p>')
})
it('applies the link field on Enter instead of submitting the surrounding form', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../../components/documents/DocumentEditor.vue'), 'utf8')
  expect(source).toMatch(/<UInput v-model="linkUrl"[^>]*@keydown\.enter\.prevent="applyLink"/)
})
