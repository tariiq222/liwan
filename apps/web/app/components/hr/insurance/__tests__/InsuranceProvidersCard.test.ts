import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { HrInsuranceProvider } from '@liwan/contracts'
import { ApiError } from '../../../../composables/useApi'
import { saveErrorMessage } from '../../../../utils/formFeedback'

// A row edit saves with the revision it started from. A background refetch that delivers a newer revision must not
// replace it, so a concurrent edit answers 409; the reload action then refetches and resets the draft.
const FILE = resolve(import.meta.dirname, '../InsuranceProvidersCard.vue')

function provider(over: Partial<HrInsuranceProvider> = {}): HrInsuranceProvider {
  return { id: 3, name: 'Bupa', active: true, revision: 4, ...over }
}

function mount(providers: HrInsuranceProvider[], patch: (input: unknown) => Promise<unknown>, reloadProviders: () => Promise<unknown>) {
  const descriptor = parse(readFileSync(FILE, 'utf8'), { filename: FILE }).descriptor
  const script = compileScript(descriptor, { id: 'insurance-providers-card' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const mutation = (fn: (input: unknown) => Promise<unknown>) => () => ({ mutateAsync: fn, isPending: Vue.ref(false) })
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true),
    useCreateHrInsuranceProvider: mutation(vi.fn()), usePatchHrInsuranceProvider: mutation(patch),
    ApiError, saveErrorMessage,
  }
  const component = new Function(...Object.keys(bindings), ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText)(...Object.values(bindings))
  const props = Vue.reactive({ providers, canEdit: true, reloadProviders })
  return { props, state: component.setup(props, { expose: () => {}, emit: () => {} }) }
}

describe('InsuranceProvidersCard revision conflicts', () => {
  it('saves with the revision the edit started from, shows the conflict, and reload resets the draft to the newer revision', async () => {
    const patch = vi.fn().mockRejectedValueOnce(new ApiError(409, 'conflict', 'changed')).mockResolvedValue(provider())
    const reloadProviders = vi.fn(async () => { card.props.providers = [provider({ name: 'Bupa Arabia', revision: 5 })] })
    const card = mount([provider()], patch, reloadProviders)
    const { state } = card

    state.setName(card.props.providers[0], 'Bupa Co')
    card.props.providers = [provider({ name: 'Bupa Arabia', revision: 5 })]
    await state.saveName(card.props.providers[0])
    expect(patch).toHaveBeenCalledWith({ id: 3, body: { revision: 4, name: 'Bupa Co' } })
    expect(state.conflict.value).toBe(true)
    expect(state.message.value).toBe('hrInsurance.providers.conflict')

    // A second save is blocked until the list is reloaded.
    await state.saveName(card.props.providers[0])
    expect(patch).toHaveBeenCalledTimes(1)

    await state.reload()
    expect(reloadProviders).toHaveBeenCalledTimes(1)
    expect(state.conflict.value).toBe(false)
    expect(state.draft(card.props.providers[0])).toEqual({ name: 'Bupa Arabia', revision: 5 })
  })

  it('archives with the row revision and refuses an empty name', async () => {
    const patch = vi.fn().mockResolvedValue(provider())
    const card = mount([provider({ revision: 5 })], patch, vi.fn())
    await card.state.setActive(card.props.providers[0], false)
    expect(patch).toHaveBeenCalledWith({ id: 3, body: { revision: 5, active: false } })
    card.state.setName(card.props.providers[0], '  ')
    expect(card.state.savable(card.props.providers[0])).toBe(false)
  })
})
