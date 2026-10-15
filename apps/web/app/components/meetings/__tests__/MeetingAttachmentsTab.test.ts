import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'

const filename = new URL('../MeetingAttachmentsTab.vue', import.meta.url).pathname

// The component script is compiled and run against stubbed composables, as the page tests do.
function mountTab(canEdit = true) {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'meeting-attachments-tab' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const items = Vue.ref<Array<{ id: number; name: string; mimetype: string; url: string }>>([])
  const upload = vi.fn(async () => ({}))
  const remove = vi.fn(async () => ({}))
  const toast = { add: vi.fn() }
  const emitted: number[] = []
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, watch: Vue.watch, ApiError,
    useI18n: () => ({ t: (key: string) => key }), useToast: () => toast, useHydrated: () => Vue.ref(true),
    useMeetingAttachments: () => ({ data: Vue.computed(() => ({ items: items.value })), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
    useUploadMeetingAttachment: () => ({ mutateAsync: upload, isPending: Vue.ref(false) }),
    useDeleteMeetingAttachment: () => ({ mutateAsync: remove, isPending: Vue.ref(false) }),
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const state = component.setup(Vue.reactive({ meetingId: 7, canEdit }), { expose: () => {}, emit: (_event: 'count', count: number) => { emitted.push(count) } })
  return { state, items, upload, remove, toast, emitted }
}

class FakeFileReader {
  result: string | null = null
  error: Error | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsDataURL(file: File) {
    this.result = `data:${file.type};base64,${Buffer.from('ABC').toString('base64')}`
    queueMicrotask(() => this.onload?.())
  }
}

describe('MeetingAttachmentsTab', () => {
  beforeEach(() => { vi.stubGlobal('FileReader', FakeFileReader) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('uploads the chosen file as base64 and resets the field', async () => {
    const { state, upload } = mountTab()
    const reset = vi.fn()
    state.fileField.value = { reset }
    const input = { files: [new File(['ABC'], 'plan.pdf', { type: 'application/pdf' })], value: 'plan.pdf' }
    await state.onFileChange({ target: input })
    expect(upload).toHaveBeenCalledWith({ meetingId: 7, name: 'plan.pdf', mimetype: 'application/pdf', data: 'QUJD' })
    expect(input.value).toBe('')
    expect(reset).toHaveBeenCalled()
  })

  it('shows a toast when the upload fails', async () => {
    const { state, upload, toast } = mountTab()
    upload.mockRejectedValue(new ApiError(413, 'too_large', 'الملف كبير'))
    await state.onFileChange({ target: { files: [new File(['ABC'], 'plan.pdf')], value: 'plan.pdf' } })
    expect(toast.add).toHaveBeenCalledWith({ title: 'الملف كبير', color: 'error' })
  })

  it('ignores a change event without a file', async () => {
    const { state, upload } = mountTab()
    await state.onFileChange({ target: { files: [], value: '' } })
    expect(upload).not.toHaveBeenCalled()
  })

  it('asks inline before deleting, then removes the attachment and closes the confirmation', async () => {
    const { state, remove } = mountTab()
    expect(state.pendingDeleteId.value).toBeNull()
    state.pendingDeleteId.value = 5
    expect(remove).not.toHaveBeenCalled()
    await state.confirmDelete(5)
    expect(remove).toHaveBeenCalledWith({ meetingId: 7, attachmentId: 5 })
    expect(state.pendingDeleteId.value).toBeNull()
  })

  it('keeps the page informed of the attachment count', async () => {
    const { items, emitted } = mountTab()
    expect(emitted).toEqual([0])
    items.value = [{ id: 1, name: 'a', mimetype: 'text/plain', url: '/a' }, { id: 2, name: 'b', mimetype: 'text/plain', url: '/b' }]
    await Vue.nextTick()
    expect(emitted).toEqual([0, 2])
  })
})
