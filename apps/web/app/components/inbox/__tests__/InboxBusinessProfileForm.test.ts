import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { InboxBusinessProfile } from '@liwan/contracts'
import * as profileHelpers from '../../../composables/inbox/inboxProfile'

const filename = new URL('../InboxBusinessProfileForm.vue', import.meta.url).pathname
const PROFILE: InboxBusinessProfile = {
  about: 'عيادة الأمل', address: 'الرياض', description: null, email: null, websites: ['https://a.test'], vertical: 'health', picture_url: 'https://cdn.test/p.png',
}

type Call = [unknown, { onSuccess?: (value?: unknown) => void; onError?: (error: unknown) => void; onSettled?: () => void }]

// The component script is compiled and run against stubbed composables, as the other component tests do.
function mountForm(props: { appId?: string | null } = {}) {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'inbox-profile-form' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const save = vi.fn((_patch: unknown, _options: Call[1]) => {})
  const upload = vi.fn((_file: unknown, _options: Call[1]) => {})
  const toast = vi.fn()
  const reset = vi.fn()
  const bindings = {
    _defineComponent: Vue.defineComponent, _unref: Vue.unref, ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useToast: () => ({ add: toast }),
    ...profileHelpers, InboxProfilePreview: {},
    useSaveInboxBusinessProfile: () => ({ mutate: save, isPending: Vue.ref(false) }),
    useUploadInboxProfilePicture: () => ({ mutate: upload, isPending: Vue.ref(false) }),
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const reactiveProps = Vue.reactive({ channelId: 4, channelName: 'واتساب', appId: '123', profile: PROFILE, ...props })
  const state = Vue.proxyRefs(Vue.effectScope().run(() => component.setup(reactiveProps, { expose: () => {}, emit: () => {} })))
  state.picker = { reset }
  return { state, props: reactiveProps, save, upload, toast, reset }
}

const fileOf = (type: string, size: number) => ({ target: { files: [{ name: 'logo', type, size }] } }) as unknown as Event

describe('InboxBusinessProfileForm', () => {
  it('starts clean from the profile read from Meta, with live counters', () => {
    const { state } = mountForm()
    expect(state.dirty).toBe(false)
    expect(state.draft).toMatchObject({ about: 'عيادة الأمل', website1: 'https://a.test', vertical: 'health' })
    expect(state.counter('about')).toContain('inbox.profile.counter')
  })

  it('sends only what changed and ignores a submit while nothing changed', () => {
    const { state, save } = mountForm()
    state.submit()
    expect(save).not.toHaveBeenCalled()
    state.draft.address = 'جدة'
    expect(state.dirty).toBe(true)
    state.submit()
    expect(save).toHaveBeenCalledWith({ address: 'جدة' }, expect.anything())
  })

  it('blocks a submit and names the field when Meta would refuse the value', () => {
    const { state, save } = mountForm()
    state.draft.about = 'x'.repeat(140)
    expect(state.invalid('about')).toBe(true)
    expect(state.message('about', 'about')).toBe('inbox.profile.invalid.about')
    state.submit()
    expect(save).not.toHaveBeenCalled()
    state.draft.about = 'x'.repeat(139)
    expect(state.invalid('about')).toBe(false)
  })

  it('discards the draft back to the profile', () => {
    const { state } = mountForm()
    state.draft.description = 'وصف'
    state.discard()
    expect(state.dirty).toBe(false)
  })

  it('keeps unsaved text when a fresh profile arrives (a picture upload), and takes the rest', async () => {
    const { state, props } = mountForm()
    state.draft.about = 'قيد الكتابة'
    props.profile = { ...PROFILE, about: 'نبذة ميتا', description: 'وصف جديد', picture_url: 'https://cdn.test/new.png' }
    await Vue.nextTick()
    expect(state.draft).toMatchObject({ about: 'قيد الكتابة', description: 'وصف جديد' })
    expect(state.dirty).toBe(true)
  })

  it('is clean again once the saved profile comes back', async () => {
    const { state, props, save } = mountForm()
    state.draft.address = 'جدة'
    state.submit()
    const saved = { ...PROFILE, address: 'جدة' }
    save.mock.calls[0]![1].onSuccess?.(saved)
    props.profile = saved
    await Vue.nextTick()
    expect(state.dirty).toBe(false)
  })

  it('refuses a picture that is not JPEG or PNG, or larger than 5 MB, before anything is sent', () => {
    const { state, upload, reset } = mountForm()
    state.onPicture(fileOf('image/gif', 1000))
    expect(state.pictureError).toBe('inbox.profile.picture.type')
    state.onPicture(fileOf('image/png', 5 * 1024 * 1024 + 1))
    expect(state.pictureError).toBe('inbox.profile.picture.size')
    expect(upload).not.toHaveBeenCalled()
    expect(reset).toHaveBeenCalledTimes(2)
  })

  it('uploads a valid picture and clears the picker afterwards', () => {
    const { state, upload, reset } = mountForm()
    state.onPicture(fileOf('image/jpeg', 5 * 1024 * 1024))
    expect(state.pictureError).toBe('')
    expect(upload).toHaveBeenCalledTimes(1)
    upload.mock.calls[0]![1].onSettled?.()
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
