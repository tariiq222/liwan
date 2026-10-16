import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachmentProblem, fileToBase64, ATTACHMENT_ACCEPT } from '../../../utils/attachmentFile'
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
    _defineComponent: Vue.defineComponent, ref: Vue.ref, watch: Vue.watch, computed: Vue.computed, ApiError, attachmentProblem, fileToBase64, ATTACHMENT_ACCEPT,
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

  it('uploads the chosen file as base64', async () => {
    const { state, upload } = mountTab()
    await state.uploadFile(new File(['ABC'], 'plan.pdf', { type: 'application/pdf' }))
    expect(upload).toHaveBeenCalledWith({ meetingId: 7, name: 'plan.pdf', mimetype: 'application/pdf', data: 'QUJD' })
  })

  it('keeps upload failure next to the attachment list', async () => {
    const { state, upload } = mountTab()
    upload.mockRejectedValue(new ApiError(413, 'too_large', 'الملف كبير'))
    await state.uploadFile(new File(['ABC'], 'plan.pdf', { type: 'application/pdf' }))
    expect(state.actionError.value).toBe('الملف كبير')
  })

  it('blocks invalid files and read-only writes before any request', async () => {
    const editable = mountTab()
    await editable.state.uploadFile(new File(['ABC'], 'program.exe'))
    expect(editable.state.actionError.value).toBe('meetingsUx.attachmentErrors.type')
    expect(editable.upload).not.toHaveBeenCalled()
    const readOnly = mountTab(false)
    await readOnly.state.uploadFile(new File(['ABC'], 'plan.pdf'))
    await readOnly.state.deleteFile(5)
    expect(readOnly.upload).not.toHaveBeenCalled()
    expect(readOnly.remove).not.toHaveBeenCalled()
  })

  it('reports delete failure without removing the row from its query data', async () => {
    const { state, remove, items } = mountTab()
    items.value = [{ id: 5, name: 'plan.pdf', mimetype: 'application/pdf', url: '/file' }]
    remove.mockRejectedValue(new ApiError(500, 'unavailable', 'Delete failed'))
    await state.deleteFile(5)
    expect(remove).toHaveBeenCalledWith({ meetingId: 7, attachmentId: 5 })
    expect(state.actionError.value).toBe('Delete failed')
    expect(items.value).toHaveLength(1)
  })

  it('keeps the page informed of the attachment count', async () => {
    const { items, emitted } = mountTab()
    expect(emitted).toEqual([0])
    items.value = [{ id: 1, name: 'a', mimetype: 'text/plain', url: '/a' }, { id: 2, name: 'b', mimetype: 'text/plain', url: '/b' }]
    await Vue.nextTick()
    expect(emitted).toEqual([0, 2])
  })
})
