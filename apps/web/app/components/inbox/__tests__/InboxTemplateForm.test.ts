import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { InboxTemplate } from '@webvue/contracts'
import * as helpers from '../../../composables/inbox/inboxTemplate'
import { HEADER_MEDIA_ACCEPT } from '../../../composables/inbox/inboxTemplateSend'
import { inboxUploadProblem } from '../../../composables/inbox/inboxAttachments'

const filename = new URL('../InboxTemplateForm.vue', import.meta.url).pathname
const STORED: InboxTemplate = {
  id: 3, name: 'reminder', language: 'ar', category: 'utility', status: 'rejected', status_reason: 'Meta says no', quality: 'unknown', header: null,
  body: 'Hi {{1}}', body_examples: ['Sara'], footer: null, buttons: [], add_security_recommendation: false, code_expiration_minutes: null, param_count: 1, editable: true, otp_button_text: null,
}

// The component script is compiled and run against stubbed composables, as the other component tests do.
function mountForm(props: { template?: InboxTemplate; readonly?: boolean } = {}) {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'inbox-template-form' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const save = vi.fn(async (_input: { id?: number; body: unknown }) => ({ ...STORED, id: 9 }))
  const uploadSample = vi.fn(async (file: { name: string; type: string; size: number }) => ({ id: 21, name: file.name, mimetype: file.type, size: file.size }))
  const emitted: Array<[string, unknown]> = []
  const bindings = {
    _defineComponent: Vue.defineComponent, _unref: Vue.unref, _useModel: Vue.useModel, ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en') }), useHydrated: () => Vue.ref(true),
    ...helpers, HEADER_MEDIA_ACCEPT, inboxUploadProblem,
    useSaveInboxTemplate: () => ({ mutateAsync: save, isPending: Vue.ref(false) }),
    useUploadInboxTemplateSample: () => ({ mutateAsync: uploadSample }),
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const scope = Vue.effectScope()
  const state = Vue.proxyRefs(scope.run(() => component.setup(Vue.reactive({ channelId: 1, backTo: '/back', ...props }), { expose: () => {}, emit: (name: string, value: unknown) => { emitted.push([name, value]) } })))
  return { state, save, uploadSample, emitted }
}

const fill = (state: ReturnType<typeof mountForm>['state']) => {
  state.draft.name = 'order_ready'
  state.draft.body = 'Hi {{1}}'
  state.draft.bodyExamples = ['Sara']
}

describe('InboxTemplateForm', () => {
  it('turns a typed name into a Meta name', () => {
    const { state } = mountForm()
    state.onName('Order Ready')
    expect(state.draft.name).toBe('order_ready')
  })

  it('adds the next variable and one example field for it', async () => {
    const { state } = mountForm()
    state.draft.body = 'Hi'
    state.addBodyVariable()
    state.addBodyVariable()
    await Vue.nextTick()
    expect(state.draft.body).toBe('Hi{{1}}{{2}}')
    expect(state.draft.bodyExamples).toEqual(['', ''])
    state.draft.body = 'Hi{{1}}'
    await Vue.nextTick()
    expect(state.draft.bodyExamples).toEqual([''])
  })

  it('shows the field errors only after the first attempt and sends nothing while invalid', async () => {
    const { state, save } = mountForm()
    expect(state.fieldError('name')).toBeUndefined()
    await state.submit()
    expect(save).not.toHaveBeenCalled()
    expect(state.fieldError('name')).toBe('inbox.templates.invalid.name')
    expect(state.fieldError('body')).toBe('inbox.templates.invalid.body')
  })

  it('saves a valid draft with the contract payload and announces the saved template', async () => {
    const { state, save, emitted } = mountForm()
    fill(state)
    await Vue.nextTick()
    await state.submit()
    expect(save).toHaveBeenCalledWith({ id: undefined, body: expect.objectContaining({ name: 'order_ready', category: 'utility', body: 'Hi {{1}}', body_examples: ['Sara'] }) })
    expect(emitted).toEqual([['saved', expect.objectContaining({ id: 9 })]])
    expect(state.dirty).toBe(false)
  })

  it('shows Meta\'s refusal with its own words, on its field, and keeps the draft', async () => {
    const { state, save } = mountForm()
    fill(state)
    await Vue.nextTick()
    save.mockRejectedValueOnce(Object.assign(new Error('Meta: not allowed'), { field: 'body' }))
    await state.submit()
    expect(state.serverError).toEqual({ field: 'body', message: 'Meta: not allowed' })
    expect(state.fieldError('body')).toBe('Meta: not allowed')
    expect(state.draft.body).toBe('Hi {{1}}')
    await state.submit()
    expect(state.serverError).toBeNull()
  })

  it('uploads the sample file of a media header and resets it when the header type changes', async () => {
    const { state, uploadSample } = mountForm()
    state.draft.headerKind = 'image'
    await Vue.nextTick()
    const input = (name: string, type: string, size: number) => ({ target: { files: [{ name, type, size }], value: 'a' } }) as unknown as Event
    await state.onSamplePicked(input('big.png', 'image/png', 6 * 1048576))
    expect(uploadSample).not.toHaveBeenCalled()
    expect(state.sampleState.error).toBe('inbox.composer.upload.tooLarge')
    await state.onSamplePicked(input('a.png', 'image/png', 2048))
    expect(state.draft.headerSample).toMatchObject({ id: 21, name: 'a.png' })
    expect(state.sampleState.error).toBe('')
    state.draft.headerKind = 'video'
    await Vue.nextTick()
    expect(state.draft.headerSample).toBeNull()
  })

  it('shows a failed sample upload instead of attaching it', async () => {
    const { state, uploadSample } = mountForm()
    state.draft.headerKind = 'document'
    uploadSample.mockRejectedValueOnce(new Error('Meta app id missing'))
    await state.onSamplePicked({ target: { files: [{ name: 'a.pdf', type: 'application/pdf', size: 10 }], value: 'a' } } as unknown as Event)
    expect(state.sampleState.error).toBe('Meta app id missing')
    expect(state.draft.headerSample).toBeNull()
    expect(state.sampleState.uploading).toBe(false)
  })

  it('edits a stored template: name and language are fixed, nothing changed means nothing to save, a change patches by id', async () => {
    const { state, save } = mountForm({ template: STORED })
    expect(state.editing).toBe(true)
    expect(state.dirty).toBe(false)
    state.draft.body = 'Hello {{1}}'
    expect(state.dirty).toBe(true)
    await state.submit()
    expect(save).toHaveBeenCalledWith({ id: 3, body: expect.objectContaining({ name: 'reminder', language: 'ar', body: 'Hello {{1}}' }) })
  })

  it('locks the category of an approved template and every field of a read-only one', async () => {
    expect(mountForm({ template: { ...STORED, status: 'approved' } }).state.categoryLocked).toBe(true)
    expect(mountForm({ template: STORED }).state.categoryLocked).toBe(false)
    const locked = mountForm({ template: STORED, readonly: true })
    expect(locked.state.off).toBe(true)
    locked.state.draft.body = 'changed'
    await locked.state.submit()
    expect(locked.save).not.toHaveBeenCalled()
    expect(locked.state.dirty).toBe(false)
  })

  it('previews an authentication draft instead of the standard fields', () => {
    const { state } = mountForm()
    state.draft.category = 'authentication'
    expect(state.standard).toBe(false)
    expect(state.preview.buttons).toEqual([{ type: 'copy_code', text: 'inbox.templates.auth.copyCode' }])
    expect(state.preview.body).toContain('inbox.templates.auth.previewBody')
  })
})
