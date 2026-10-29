import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInboxDrafts, emptyInboxDraft } from '../../../composables/inbox/inboxDrafts'
import { INBOX_CAPTION_MAX, INBOX_UPLOAD_ACCEPT, inboxAcceptsCaption, inboxFileSize, inboxUploadProblem } from '../../../composables/inbox/inboxAttachments'
import { buildInteractive, emptyInteractiveDraft } from '../../../composables/inbox/inboxInteractive'
import { buildLocation, emptyLocationDraft } from '../../../composables/inbox/inboxLocation'
import { TEMPLATE_CATEGORY_TONE, templatePreview } from '../../../composables/inbox/inboxTemplate'
import { HEADER_MEDIA_ACCEPT, buildTemplateReply, dynamicButtons, headerInput, templateReplyReady } from '../../../composables/inbox/inboxTemplateSend'
import { cannedSuggestions, replyWindowOpen } from '../../../composables/inbox/inboxWindow'

const filename = new URL('../InboxComposer.vue', import.meta.url).pathname
const NOW = Date.parse('2026-10-28T12:00:00Z')
const TEMPLATE = {
  id: 7, name: 'reminder', language: 'ar', category: 'utility', status: 'approved', status_reason: null, quality: 'green', header: null,
  body: 'مرحبا {{1}}', body_examples: ['فهد'], footer: null, buttons: [], add_security_recommendation: false, code_expiration_minutes: null, param_count: 1, editable: true, otp_button_text: null, supported: true,
}

// The component script is compiled and run against stubbed composables, as the other component tests do.
class ApiError extends Error {
  constructor(public status: number) { super('refused') }
}

function mountComposer(endsAt: string | null, store = new Map<string, string>(), template: Record<string, unknown> = TEMPLATE) {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'inbox-composer' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const inboxDrafts = createInboxDrafts(() => ({ getItem: k => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: k => void store.delete(k), key: i => [...store.keys()][i] ?? null, length: store.size }))
  const sendReply = vi.fn(async (_body: Record<string, unknown>) => ({}))
  const sendNote = vi.fn(async (_body: Record<string, unknown>) => ({}))
  const mounted: Array<() => void> = []
  const unmounting: Array<() => void> = []
  const templatesEnabled = Vue.ref(false)
  const notifyTyping = vi.fn()
  const uploadInboxFile = vi.fn(async (file: { name: string; size: number; type: string }) => ({ id: 41, name: file.name, mimetype: file.type, size: file.size }))
  const emitted: Array<[string, unknown]> = []
  const bindings = {
    _defineComponent: Vue.defineComponent, _unref: Vue.unref, ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch,
    onMounted: (fn: () => void) => mounted.push(fn), onBeforeUnmount: (fn: () => void) => unmounting.push(fn),
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useToast: () => ({ add: vi.fn() }), useMe: () => ({ me: Vue.ref({ id: 3 }) }),
    ApiError, useInboxTyping: () => notifyTyping, useUploadInboxFile: () => ({ mutateAsync: uploadInboxFile }), INBOX_CAPTION_MAX, INBOX_UPLOAD_ACCEPT, inboxAcceptsCaption, inboxFileSize, inboxUploadProblem, emptyInboxDraft,
    buildInteractive, emptyInteractiveDraft, buildLocation, emptyLocationDraft,
    inboxDrafts, cannedSuggestions, replyWindowOpen, templatePreview, TEMPLATE_CATEGORY_TONE, HEADER_MEDIA_ACCEPT, buildTemplateReply, dynamicButtons, headerInput, templateReplyReady,
    useSendInboxReply: () => ({ mutateAsync: sendReply, isPending: Vue.ref(false) }), useSendInboxNote: () => ({ mutateAsync: sendNote, isPending: Vue.ref(false) }),
    useInboxCannedReplies: () => ({ data: Vue.ref({ items: [], total: 0 }) }),
    useInboxTemplates: (_channel: unknown, enabled: Vue.Ref<boolean>) => { templatesEnabled.value = enabled.value; return { data: Vue.ref({ items: [template], total: 1 }), isLoading: Vue.ref(false), isError: Vue.ref(false), refetch: vi.fn() } },
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const props = Vue.reactive({ conversation: { id: 5, channel: { id: 1 }, reply_window_ends_at: endsAt }, replyTo: null as { id: number; preview: string } | null })
  const scope = Vue.effectScope()
  const state = scope.run(() => component.setup(props, { expose: () => {}, emit: (name: string, value: unknown) => { emitted.push([name, value]); if (name === 'update:replyTo') props.replyTo = value as typeof props.replyTo } }))
  for (const fn of mounted) fn()
  return { state, props, store, sendReply, sendNote, inboxDrafts, notifyTyping, uploadInboxFile, emitted, unmount: () => { for (const fn of unmounting) fn(); scope.stop() } }
}

describe('InboxComposer', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => vi.useRealTimers())

  it('switches to the template picker when the reply window expires, without any other change', async () => {
    const { state, unmount } = mountComposer('2026-10-28T12:00:10Z')
    expect(state.templateMode.value).toBe(false)
    vi.advanceTimersByTime(9_000)
    expect(state.templateMode.value).toBe(false)
    vi.advanceTimersByTime(2_000)
    expect(state.templateMode.value).toBe(true)
    unmount()
  })

  it('reschedules when a new inbound message moves the window end, and stops its timer on unmount', async () => {
    const { state, props, unmount } = mountComposer('2026-10-28T12:00:10Z')
    props.conversation.reply_window_ends_at = '2026-10-28T12:01:00Z'
    await Vue.nextTick()
    vi.advanceTimersByTime(20_000)
    expect(state.templateMode.value).toBe(false)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('is in template mode at once when the window never opened or already closed', () => {
    expect(mountComposer(null).state.templateMode.value).toBe(true)
    expect(mountComposer('2026-10-27T11:00:00Z').state.templateMode.value).toBe(true)
  })

  it('stores reply and note drafts per conversation and restores them on the next mount', async () => {
    const first = mountComposer('2026-10-28T20:00:00Z')
    first.state.draft.value = 'مرحبا بك'
    first.state.mode.value = 'note'
    first.state.draft.value = 'ملاحظة'
    await Vue.nextTick()
    expect(first.inboxDrafts.get(3, 5)).toMatchObject({ reply: 'مرحبا بك', note: 'ملاحظة' })
    expect(first.inboxDrafts.get(3, 6).reply).toBe('')
    first.unmount()

    // The same user opening the same conversation again gets both texts back; another conversation starts empty.
    const reopened = mountComposer('2026-10-28T20:00:00Z', first.store)
    expect(reopened.state.draft.value).toBe('مرحبا بك')
    reopened.state.mode.value = 'note'
    expect(reopened.state.draft.value).toBe('ملاحظة')
  })

  it('clears the draft only after a successful send and keeps it when the send fails', async () => {
    const { state, sendReply, inboxDrafts } = mountComposer('2026-10-28T20:00:00Z')
    state.draft.value = 'رد'
    sendReply.mockRejectedValueOnce(new Error('closed'))
    await state.submit()
    expect(state.draft.value).toBe('رد')
    await Vue.nextTick()
    expect(inboxDrafts.get(3, 5).reply).toBe('رد')
    await state.submit()
    expect(sendReply).toHaveBeenLastCalledWith({ body: 'رد' })
    expect(state.draft.value).toBe('')
    await Vue.nextTick()
    expect(inboxDrafts.get(3, 5).reply).toBe('')
  })

  it('keeps template parameters as a draft and clears them after the template is sent', async () => {
    const { state, sendReply, inboxDrafts } = mountComposer(null)
    state.templateId.value = TEMPLATE.id
    await Vue.nextTick()
    state.params.value = ['فهد']
    await Vue.nextTick()
    expect(inboxDrafts.get(3, 5)).toMatchObject({ templateId: 7, params: ['فهد'] })
    await state.submit()
    expect(sendReply).toHaveBeenCalledWith({ template_id: 7, params: ['فهد'] })
    await Vue.nextTick()
    expect(inboxDrafts.get(3, 5)).toMatchObject({ templateId: null, params: [] })
  })

  const file = (name: string, type: string, size: number) => ({ target: { files: [{ name, type, size }] } }) as unknown as Event

  it('refuses an image over 5 MB before any upload and says why', async () => {
    const { state, uploadInboxFile } = mountComposer('2026-10-28T20:00:00Z')
    await state.onFilePicked(file('كبيرة.png', 'image/png', 6 * 1048576))
    expect(uploadInboxFile).not.toHaveBeenCalled()
    expect(state.upload.value).toBeNull()
    expect(state.uploadError.value).toBe('inbox.composer.upload.tooLarge')
    await state.onFilePicked(file('ok.pdf', 'application/pdf', 10 * 1048576))
    expect(state.uploadError.value).toBe('')
    await state.onFilePicked(file('big.pdf', 'application/pdf', 10 * 1048576 + 1))
    expect(state.uploadError.value).toBe('inbox.composer.upload.tooLarge')
    await state.onFilePicked(file('ok.pdf', 'application/pdf', 10 * 1048576))
    expect(state.uploadError.value).toBe('')
  })

  it('uploads a file and sends it with the draft as caption and the quoted message', async () => {
    const { state, props, sendReply, uploadInboxFile } = mountComposer('2026-10-28T20:00:00Z')
    props.replyTo = { id: 9, preview: 'السؤال' }
    state.draft.value = 'تفضل'
    expect(state.quoted.value).toEqual({ id: 9, preview: 'السؤال' })
    await state.onFilePicked(file('خطة.pdf', 'application/pdf', 2048))
    expect(uploadInboxFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'خطة.pdf' }))
    expect(state.canSend.value).toBe(true)
    await state.submit()
    expect(sendReply).toHaveBeenCalledWith({ attachment_id: 41, caption: 'تفضل', reply_to_id: 9 })
    expect(state.upload.value).toBeNull()
    expect(props.replyTo).toBeNull()
  })

  it('cannot send while a file is still uploading, and shows a 413 as the size message', async () => {
    const { state, uploadInboxFile } = mountComposer('2026-10-28T20:00:00Z')
    let finish: (value: unknown) => void = () => {}
    uploadInboxFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as never)
    const picking = state.onFilePicked(file('a.pdf', 'application/pdf', 10))
    expect(state.uploading.value).toBe(true)
    expect(state.canSend.value).toBe(false)
    finish({ id: 2, name: 'a.pdf', mimetype: 'application/pdf', size: 10 })
    await picking
    expect(state.canSend.value).toBe(true)
    uploadInboxFile.mockRejectedValueOnce(new ApiError(413))
    await state.onFilePicked(file('b.pdf', 'application/pdf', 10))
    expect(state.uploadError.value).toBe('inbox.composer.upload.tooLargeServer')
    expect(state.upload.value).toBeNull()
  })

  it('sends a location only when the coordinates are valid and drops it when the panel closes', async () => {
    const { state, sendReply } = mountComposer('2026-10-28T20:00:00Z')
    state.togglePanel('location')
    expect(state.canSend.value).toBe(false)
    state.location.value = { ...emptyLocationDraft(), latitude: '24.7136', longitude: '46.6753', name: 'المكتب' }
    expect(state.canSend.value).toBe(true)
    await state.submit()
    expect(sendReply).toHaveBeenCalledWith({ location: { latitude: 24.7136, longitude: 46.6753, name: 'المكتب', address: null } })
    expect(state.panel.value).toBeNull()
    state.togglePanel('location')
    state.location.value = { ...emptyLocationDraft(), latitude: '1', longitude: '2' }
    state.togglePanel('location')
    state.togglePanel('location')
    expect(state.location.value.latitude).toBe('')
  })

  it('keeps typed text that a location reply did not carry', async () => {
    const { state, sendReply, inboxDrafts } = mountComposer('2026-10-28T20:00:00Z')
    state.draft.value = 'نص لم يُرسل'
    state.togglePanel('location')
    state.location.value = { ...emptyLocationDraft(), latitude: '24.7', longitude: '46.6' }
    await state.submit()
    expect(sendReply).toHaveBeenCalledWith({ location: expect.objectContaining({ latitude: 24.7 }) })
    await Vue.nextTick()
    expect(state.draft.value).toBe('نص لم يُرسل')
    expect(inboxDrafts.get(3, 5).reply).toBe('نص لم يُرسل')
  })

  it('sends an interactive message only when it respects the limits, and keeps it as a draft', async () => {
    const { state, sendReply, inboxDrafts } = mountComposer('2026-10-28T20:00:00Z')
    state.togglePanel('interactive')
    state.interactive.value = { ...emptyInteractiveDraft(), body: 'هل تؤكد؟', buttons: ['نعم', 'لا'] }
    await Vue.nextTick()
    expect(inboxDrafts.get(3, 5).interactive).toMatchObject({ body: 'هل تؤكد؟', buttons: ['نعم', 'لا'] })
    state.interactive.value.buttons[0] = 'x'.repeat(21)
    expect(state.canSend.value).toBe(false)
    state.interactive.value.buttons[0] = 'نعم'
    await state.submit()
    expect(sendReply).toHaveBeenCalledWith({ interactive: expect.objectContaining({ type: 'buttons', body: 'هل تؤكد؟' }) })
    await Vue.nextTick()
    expect(inboxDrafts.get(3, 5)).toEqual(emptyInboxDraft())
  })

  it('restores a stored quoted message and an open panel on the next mount', async () => {
    const first = mountComposer('2026-10-28T20:00:00Z')
    first.props.replyTo = { id: 4, preview: 'سؤال' }
    first.state.togglePanel('location')
    first.state.location.value = { ...emptyLocationDraft(), latitude: '10', longitude: '20' }
    await Vue.nextTick()
    const reopened = mountComposer('2026-10-28T20:00:00Z', first.store)
    expect(reopened.emitted).toContainEqual(['update:replyTo', { id: 4, preview: 'سؤال' }])
    expect(reopened.state.panel.value).toBe('location')
    expect(reopened.state.location.value.latitude).toBe('10')
  })

  const key = (value: string) => ({ key: value, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, preventDefault: () => {} }) as unknown as KeyboardEvent

  it('reports typing only on real keystrokes in a reply, never for a restored draft', async () => {
    const first = mountComposer('2026-10-28T20:00:00Z')
    first.state.draft.value = 'مسودة'
    await Vue.nextTick()
    const reopened = mountComposer('2026-10-28T20:00:00Z', first.store)
    expect(reopened.state.draft.value).toBe('مسودة')
    expect(reopened.notifyTyping).not.toHaveBeenCalled()
    expect(first.notifyTyping).not.toHaveBeenCalled()
    reopened.state.onKeydown(key('م'))
    expect(reopened.notifyTyping).toHaveBeenCalledTimes(1)
    reopened.state.onKeydown(key('Shift'))
    reopened.state.onKeydown(key('ArrowLeft'))
    expect(reopened.notifyTyping).toHaveBeenCalledTimes(1)
    reopened.state.mode.value = 'note'
    reopened.state.onKeydown(key('a'))
    expect(reopened.notifyTyping).toHaveBeenCalledTimes(1)
    const closed = mountComposer(null)
    closed.state.onKeydown(key('a'))
    expect(closed.notifyTyping).not.toHaveBeenCalled()
  })

  it('takes no caption on audio and keeps a file caption within 1024 characters', async () => {
    const { state, sendReply } = mountComposer('2026-10-28T20:00:00Z')
    await state.onFilePicked(file('note.ogg', 'audio/ogg', 2048))
    expect(state.captionAllowed.value).toBe(false)
    state.draft.value = 'تعليق'
    await state.submit()
    expect(sendReply).toHaveBeenLastCalledWith({ attachment_id: 41 })
    await state.onFilePicked(file('plan.pdf', 'application/pdf', 2048))
    expect(state.captionAllowed.value).toBe(true)
    state.draft.value = 'ت'.repeat(INBOX_CAPTION_MAX + 1)
    expect(state.captionTooLong.value).toBe(true)
    expect(state.canSend.value).toBe(false)
    state.draft.value = 'ت'.repeat(INBOX_CAPTION_MAX)
    expect(state.canSend.value).toBe(true)
  })

  it('does not quote a message when a template is sent', async () => {
    const { state, props, sendReply } = mountComposer(null)
    props.replyTo = { id: 4, preview: 'سؤال' }
    expect(state.quoted.value).toBeNull()
    state.templateId.value = TEMPLATE.id
    await Vue.nextTick()
    state.params.value = ['فهد']
    await state.submit()
    expect(sendReply).toHaveBeenCalledWith({ template_id: 7, params: ['فهد'] })
  })

  describe('template inputs', () => {
    const FULL = {
      ...TEMPLATE,
      header: { type: 'text', text: 'طلب {{1}}', example: 'x' },
      buttons: [{ type: 'quick_reply', text: 'نعم' }, { type: 'url', text: 'تتبع', url: 'https://example.test/{{1}}', example: 'https://example.test/1' }, { type: 'copy_code', example: 'SAVE' }],
    }
    const pick = async (state: ReturnType<typeof mountComposer>['state']) => {
      state.templateId.value = 7
      await Vue.nextTick()
    }

    it('asks for the header value and one value per dynamic button, and sends them by position', async () => {
      const { state, sendReply } = mountComposer(null, new Map(), FULL)
      await pick(state)
      expect(state.headerNeeds.value).toEqual({ kind: 'text' })
      expect(state.buttonInputs.value.map((button: { index: number }) => button.index)).toEqual([1, 2])
      state.params.value = ['فهد']
      expect(state.canSend.value).toBe(false)
      state.headerParam.value = 'A-1'
      state.buttonValues.value = ['4521', '']
      expect(state.canSend.value).toBe(false)
      state.buttonValues.value = ['4521', 'SAVE10']
      expect(state.canSend.value).toBe(true)
      await state.submit()
      expect(sendReply).toHaveBeenCalledWith({ template_id: 7, params: ['فهد'], header_param: 'A-1', button_params: [{ index: 1, value: '4521' }, { index: 2, value: 'SAVE10' }] })
      expect(state.headerParam.value).toBe('')
      expect(state.buttonValues.value).toEqual([])
    })

    it('keeps header and button values as a draft', async () => {
      const first = mountComposer(null, new Map(), FULL)
      await pick(first.state)
      first.state.headerParam.value = 'A-1'
      first.state.buttonValues.value = ['4521', 'SAVE10']
      await Vue.nextTick()
      expect(first.inboxDrafts.get(3, 5)).toMatchObject({ headerParam: 'A-1', buttonParams: ['4521', 'SAVE10'] })
      const reopened = mountComposer(null, first.store, FULL)
      expect(reopened.state.headerParam.value).toBe('A-1')
      expect(reopened.state.buttonValues.value).toEqual(['4521', 'SAVE10'])
    })

    const MEDIA = { ...TEMPLATE, header: { type: 'image', example_attachment: null } }

    it('uploads the header file of the conversation and sends its id', async () => {
      const { state, sendReply, uploadInboxFile } = mountComposer(null, new Map(), MEDIA)
      await pick(state)
      state.params.value = ['فهد']
      expect(state.canSend.value).toBe(false)
      await state.onHeaderPicked({ target: { files: [{ name: 'a.png', type: 'image/png', size: 2048 }], value: 'a' } } as unknown as Event)
      expect(uploadInboxFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'a.png' }))
      expect(state.canSend.value).toBe(true)
      expect(state.previewParts.value.header).toEqual({ kind: 'media', media: 'image', name: 'a.png' })
      await state.submit()
      expect(sendReply).toHaveBeenCalledWith({ template_id: 7, params: ['فهد'], header_attachment_id: 41 })
      expect(state.headerUpload.value).toBeNull()
    })

    it('refuses a header file of the wrong kind or over the limit before uploading', async () => {
      const { state, uploadInboxFile } = mountComposer(null, new Map(), MEDIA)
      await pick(state)
      const input = (name: string, type: string, size: number) => ({ target: { files: [{ name, type, size }], value: 'a' } }) as unknown as Event
      await state.onHeaderPicked(input('a.pdf', 'application/pdf', 100))
      expect(state.headerError.value).toBe('inbox.composer.headerWrongType.image')
      await state.onHeaderPicked(input('big.png', 'image/png', 6 * 1048576))
      expect(state.headerError.value).toBe('inbox.composer.upload.tooLarge')
      expect(uploadInboxFile).not.toHaveBeenCalled()
      expect(state.headerUpload.value).toBeNull()
    })

    it('waits for the header upload to finish', async () => {
      const { state, uploadInboxFile } = mountComposer(null, new Map(), MEDIA)
      await pick(state)
      state.params.value = ['فهد']
      let finish: (value: unknown) => void = () => {}
      uploadInboxFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as never)
      const picking = state.onHeaderPicked({ target: { files: [{ name: 'a.png', type: 'image/png', size: 10 }], value: 'a' } } as unknown as Event)
      expect(state.headerUploading.value).toBe(true)
      expect(state.canSend.value).toBe(false)
      finish({ id: 5, name: 'a.png', mimetype: 'image/png', size: 10 })
      await picking
      expect(state.canSend.value).toBe(true)
    })

    it('sends a location header once valid coordinates are entered', async () => {
      const place = { ...TEMPLATE, header: { type: 'location' } }
      const { state, sendReply } = mountComposer(null, new Map(), place)
      await pick(state)
      state.params.value = ['فهد']
      expect(state.canSend.value).toBe(false)
      state.headerLocation.value = { ...emptyLocationDraft(), latitude: '24.7', longitude: '46.6' }
      expect(state.canSend.value).toBe(true)
      await state.submit()
      expect(sendReply).toHaveBeenCalledWith(expect.objectContaining({ header_location: { latitude: 24.7, longitude: 46.6, name: null, address: null } }))
    })

    it('asks an authentication template for its code only', async () => {
      const auth = { ...TEMPLATE, category: 'authentication', otp_button_text: 'نسخ' }
      const { state, sendReply } = mountComposer(null, new Map(), auth)
      await pick(state)
      expect(state.buttonInputs.value).toEqual([])
      state.params.value = ['918273']
      expect(state.canSend.value).toBe(true)
      expect(state.previewParts.value.buttons).toEqual([{ type: 'copy_code', text: 'نسخ' }])
      await state.submit()
      expect(sendReply).toHaveBeenCalledWith({ template_id: 7, params: ['918273'] })
    })

    it('does not offer a template WebVue cannot fill', async () => {
      const { state } = mountComposer(null, new Map(), { ...TEMPLATE, supported: false })
      expect(state.templateItems.value).toEqual([])
      state.templateId.value = 7
      await Vue.nextTick()
      expect(state.selectedTemplate.value).toBeUndefined()
      expect(state.canSend.value).toBe(false)
    })

    it('starts every input empty when the template is deselected and chosen again', async () => {
      const { state } = mountComposer(null, new Map(), FULL)
      await pick(state)
      state.params.value = ['فهد']
      state.headerParam.value = 'A-1'
      state.buttonValues.value = ['1', '2']
      state.templateId.value = undefined
      await Vue.nextTick()
      expect(state.headerParam.value).toBe('')
      state.templateId.value = 7
      await Vue.nextTick()
      expect(state.params.value).toEqual([''])
      expect(state.buttonValues.value).toEqual(['', ''])
    })
  })
})
