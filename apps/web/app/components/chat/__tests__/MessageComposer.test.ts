import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { ATTACHMENT_ACCEPT, attachmentProblem, fileToBase64 } from '../../../utils/attachmentFile'
import { composerKeyAction, mentionIdsInText, moveHighlight, shouldNotifyTyping } from '../../../utils/chatComposer'
import { preserveFailedDraft } from '../../../utils/chatState'

const filename = new URL('../MessageComposer.vue', import.meta.url).pathname

// The component script is compiled and run against stubbed composables, as the other component tests do.
function mountComposer() {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'message-composer' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const send = vi.fn(async (_body: Record<string, unknown>) => ({}))
  const typing = vi.fn()
  const toast = { add: vi.fn() }
  const members = { items: [{ id: 7, name: 'Sara', im_status: null }, { id: 8, name: 'Khaled', im_status: null }] }
  const draft = Vue.ref('')
  const bindings = {
    _defineComponent: Vue.defineComponent, _useModel: () => draft, _mergeModels: (a: object, b: object) => ({ ...a, ...b }), _unref: Vue.unref, ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, onUnmounted: Vue.onUnmounted,
    ApiError, ATTACHMENT_ACCEPT, attachmentProblem, fileToBase64, composerKeyAction, mentionIdsInText, moveHighlight, shouldNotifyTyping, preserveFailedDraft,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useToast: () => toast,
    useSendChatMessage: () => ({ mutateAsync: send }), useChatTyping: () => ({ mutate: typing }), useChatMembers: () => ({ data: Vue.ref(members) }),
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const props = Vue.reactive({ conversationId: 5 })
  const emitted: string[] = []
  const state = component.setup(props, { expose: () => {}, emit: (event: string) => { emitted.push(event) } })
  return { state, props, draft, send, typing, toast, emitted }
}

const fileInput = (file: File) => ({ target: { files: [file], value: 'x' } }) as unknown as Event
const keydown = (key: string) => ({ key, shiftKey: false, preventDefault: vi.fn() }) as unknown as KeyboardEvent

describe('MessageComposer', () => {
  it('rejects a file of a wrong type or size before reading it, with a localized error', () => {
    const { state } = mountComposer()
    state.onFile(fileInput(new File(['x'], 'run.exe', { type: 'application/octet-stream' })))
    expect(state.file.value).toBeNull()
    expect(state.fileError.value).toBe('chat.attachmentErrors.type')
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 })
    state.onFile(fileInput(big))
    expect(state.file.value).toBeNull()
    expect(state.fileError.value).toBe('chat.attachmentErrors.tooLarge')
  })

  it('accepts a valid file and removing it clears it', () => {
    const { state } = mountComposer()
    state.onFile(fileInput(new File(['x'], 'plan.pdf', { type: 'application/pdf' })))
    expect(state.file.value?.name).toBe('plan.pdf')
    expect(state.fileError.value).toBe('')
    state.removeFile()
    expect(state.file.value).toBeNull()
  })

  it('sends only the mentions whose @name is still in the draft', async () => {
    const { state, draft, send } = mountComposer()
    draft.value = '@'
    await Vue.nextTick()
    state.pickMention({ id: 7, name: 'Sara' })
    state.pickMention({ id: 8, name: 'Khaled' })
    draft.value = 'hello @Khaled '
    await state.submit()
    expect(send.mock.calls[0]![0]).toMatchObject({ body: 'hello @Khaled ', mention_user_ids: [8] })
  })

  it('arrow keys move the highlight and Enter picks instead of sending while the suggestions are open', async () => {
    const { state, draft, send } = mountComposer()
    draft.value = 'hi @'
    await Vue.nextTick()
    expect(state.mentionOpen.value).toBe(true)
    state.onKeydown(keydown('ArrowDown'))
    expect(state.highlighted.value).toBe(1)
    const enter = keydown('Enter')
    state.onKeydown(enter)
    expect(draft.value).toBe('hi @Khaled ')
    expect(send).not.toHaveBeenCalled()
    state.onKeydown(keydown('Enter'))
    await Vue.nextTick()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('Escape closes the suggestions and Enter then sends', async () => {
    const { state, draft, send } = mountComposer()
    draft.value = 'hi @'
    await Vue.nextTick()
    state.onKeydown(keydown('Escape'))
    expect(state.mentionOpen.value).toBe(false)
    state.onKeydown(keydown('Enter'))
    await Vue.nextTick()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('tells the server about typing at most once per 3 seconds', () => {
    vi.useFakeTimers()
    const { state, typing } = mountComposer()
    for (let i = 0; i < 5; i++) { state.onDraft(); vi.advanceTimersByTime(100) }
    expect(typing.mock.calls.filter(call => call[0] === true)).toHaveLength(1)
    vi.advanceTimersByTime(3000)
    expect(typing).toHaveBeenLastCalledWith(false)
    vi.useRealTimers()
  })

  it('clears the draft after a successful send and keeps it after a failure', async () => {
    const { state, draft, send, toast } = mountComposer()
    draft.value = 'keep me'
    send.mockRejectedValueOnce(new Error('offline'))
    await state.submit()
    expect(draft.value).toBe('keep me')
    expect(toast.add).toHaveBeenCalled()
    await state.submit()
    expect(draft.value).toBe('')
  })
})
