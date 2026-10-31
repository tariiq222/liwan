import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { saveErrorMessage } from '../../../utils/formFeedback'

const filename = new URL('../ChatSettingsCard.vue', import.meta.url).pathname

type Mode = 'placeholder' | 'permanent'
const settings = (mode: Mode, revision: number) => ({
  values: { message_delete_mode: mode },
  defaults: { message_delete_mode: 'placeholder' as Mode },
  options: { message_delete_mode: ['placeholder', 'permanent'] as Mode[] },
  revision,
})

// The component script is compiled and run against stubbed composables, as the page tests do.
function mountCard(props: { settings: ReturnType<typeof settings>; reloadSettings: () => Promise<ReturnType<typeof settings>> }) {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'chat-settings-card' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const save = { mutateAsync: vi.fn(), isPending: Vue.ref(false) }
  const toast = { add: vi.fn() }
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, ApiError, saveErrorMessage,
    useI18n: () => ({ t: (key: string) => key }), useToast: () => toast, useHydrated: () => Vue.ref(true),
    useSaveChatSettings: () => save,
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const state = component.setup(Vue.reactive(props), { expose: () => {}, emit: () => {} })
  return { state, save, toast }
}

describe('ChatSettingsCard', () => {
  it('lists the server options with their labels from the locale', () => {
    const { state } = mountCard({ settings: settings('placeholder', 0), reloadSettings: vi.fn() })
    expect(state.items.value.map((item: { value: string; label: string }) => [item.value, item.label])).toEqual([
      ['placeholder', 'chatSettings.delete.placeholder'],
      ['permanent', 'chatSettings.delete.permanent'],
    ])
    expect(state.dirty.value).toBe(false)
  })

  it('saves the chosen mode with the revision it was made from', async () => {
    const { state, save, toast } = mountCard({ settings: settings('placeholder', 3), reloadSettings: vi.fn() })
    save.mutateAsync.mockResolvedValue(settings('permanent', 4))
    state.mode.value = 'permanent'
    expect(state.dirty.value).toBe(true)
    await state.submit()
    expect(save.mutateAsync).toHaveBeenCalledWith({ revision: 3, values: { message_delete_mode: 'permanent' } })
    expect(state.dirty.value).toBe(false)
    expect(toast.add).toHaveBeenCalledWith({ title: 'chatSettings.saved', color: 'success' })
  })

  it('saves nothing while the choice is unchanged', async () => {
    const { state, save } = mountCard({ settings: settings('placeholder', 0), reloadSettings: vi.fn() })
    await state.submit()
    expect(save.mutateAsync).not.toHaveBeenCalled()
  })

  it('reads the saved settings again and warns when another session saved first (409)', async () => {
    const reloadSettings = vi.fn(async () => settings('permanent', 5))
    const { state, save } = mountCard({ settings: settings('placeholder', 3), reloadSettings })
    save.mutateAsync.mockRejectedValue(new ApiError(409, 'conflict', 'stale'))
    state.mode.value = 'permanent'
    await state.submit()
    expect(reloadSettings).toHaveBeenCalledOnce()
    expect(state.notice.value).toBe('conflict')
    expect(state.mode.value).toBe('permanent')
    expect(state.dirty.value).toBe(false)
  })

  it('shows the server message of a refused save', async () => {
    const { state, save } = mountCard({ settings: settings('placeholder', 3), reloadSettings: vi.fn() })
    save.mutateAsync.mockRejectedValue(new ApiError(422, 'invalid', 'message_delete_mode must be one of: placeholder, permanent', 'message_delete_mode'))
    state.mode.value = 'permanent'
    await state.submit()
    expect(state.failure.value).toBe('message_delete_mode must be one of: placeholder, permanent')
  })
})
