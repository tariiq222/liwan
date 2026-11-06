import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { useSettingsForm } from '../../../composables/settings/useSettingsForm'

const filename = new URL('../ChatSettingsCard.vue', import.meta.url).pathname

type Mode = 'placeholder' | 'permanent'
const settings = (mode: Mode, revision: number) => ({
  values: { message_delete_mode: mode },
  defaults: { message_delete_mode: 'placeholder' as Mode },
  options: { message_delete_mode: ['placeholder', 'permanent'] as Mode[] },
  revision,
})

// The component script is compiled and run against stubbed composables, as the page tests do.
function mountCard(props: { settings: ReturnType<typeof settings>; canEdit?: boolean; reloadSettings?: () => Promise<ReturnType<typeof settings>> }) {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'chat-settings-card' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const mutateAsync = vi.fn()
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true),
    useSaveChatSettings: () => ({ mutateAsync }), useSettingsForm,
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const form = component.setup(Vue.reactive({ canEdit: true, reloadSettings: vi.fn(), ...props }), { expose: () => {}, emit: () => {} })
  return { form, mutateAsync }
}

beforeEach(() => { vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })) })

describe('ChatSettingsCard', () => {
  it('lists the server options with their labels from the locale', () => {
    const { form } = mountCard({ settings: settings('placeholder', 0) })
    expect(form.items.value.map((item: { value: string; label: string }) => [item.value, item.label])).toEqual([
      ['placeholder', 'chatSettings.delete.placeholder'],
      ['permanent', 'chatSettings.delete.permanent'],
    ])
    expect(form.state.value.dirty).toBe(false)
  })

  it('saves the chosen mode with the newest revision the page knows', async () => {
    const { form, mutateAsync } = mountCard({ settings: settings('placeholder', 3) })
    mutateAsync.mockResolvedValue(settings('permanent', 4))
    form.draft.value.message_delete_mode = 'permanent'
    expect(form.state.value.dirty).toBe(true)
    await form.submit()
    expect(mutateAsync).toHaveBeenCalledWith({ revision: 3, values: { message_delete_mode: 'permanent' } })
    expect(form.state.value.dirty).toBe(false)
  })

  it('saves nothing while the choice is unchanged', async () => {
    const { form, mutateAsync } = mountCard({ settings: settings('placeholder', 0) })
    await form.submit()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('saves nothing for a viewer who may not edit', async () => {
    const { form, mutateAsync } = mountCard({ settings: settings('placeholder', 0), canEdit: false })
    form.draft.value.message_delete_mode = 'permanent'
    await form.submit()
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(form.locked.value).toBe(true)
  })

  it('keeps the draft and locks on a 409 until the saved settings are reloaded', async () => {
    const reloadSettings = vi.fn(async () => settings('permanent', 5))
    const { form, mutateAsync } = mountCard({ settings: settings('placeholder', 3), reloadSettings })
    mutateAsync.mockRejectedValue(new ApiError(409, 'conflict', 'stale'))
    form.draft.value.message_delete_mode = 'permanent'
    await form.submit()
    expect(form.state.value.conflict).toBe(true)
    expect(form.state.value.message).toBe('app.settingsConflict')
    await form.submit()
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    await form.reload()
    expect(reloadSettings).toHaveBeenCalledOnce()
    expect(form.state.value.conflict).toBe(false)
    expect(form.draft.value.message_delete_mode).toBe('permanent')
    expect(form.state.value.dirty).toBe(false)
  })

  it('shows the server message of a refused save inside the card', async () => {
    const { form, mutateAsync } = mountCard({ settings: settings('placeholder', 3) })
    mutateAsync.mockRejectedValue(new ApiError(422, 'invalid', 'message_delete_mode must be one of: placeholder, permanent', 'message_delete_mode'))
    form.draft.value.message_delete_mode = 'permanent'
    await form.submit()
    expect(form.state.value.message).toBe('message_delete_mode must be one of: placeholder, permanent')
  })
})
