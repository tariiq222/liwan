import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { HrWarningType } from '@liwan/contracts'
import { ApiError } from '../../../../composables/useApi'
import { saveErrorMessage } from '../../../../utils/formFeedback'
import { sortHrWarningTypes } from '../../../../utils/hrWarnings'

// A row edit saves with the revision it started from. A background refetch that delivers a newer revision
// must not replace it, so a concurrent edit by another manager answers 409; the reload action then refetches
// and resets the draft to the newer revision.
const FILE = resolve(import.meta.dirname, '../WarningTypesCard.vue')

function type(over: Partial<HrWarningType> = {}): HrWarningType {
  return { id: 3, name: 'Verbal', severity: 1, active: true, revision: 4, ...over }
}

function mount(types: HrWarningType[], patch: (input: unknown) => Promise<unknown>, reloadTypes: () => Promise<unknown>) {
  const descriptor = parse(readFileSync(FILE, 'utf8'), { filename: FILE }).descriptor
  const script = compileScript(descriptor, { id: 'warning-types-card' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const mutation = (fn: (input: unknown) => Promise<unknown>) => () => ({ mutateAsync: fn, isPending: Vue.ref(false) })
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true),
    useCreateHrWarningType: mutation(vi.fn()), usePatchHrWarningType: mutation(patch),
    ApiError, saveErrorMessage, sortHrWarningTypes,
  }
  const component = new Function(...Object.keys(bindings), ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText)(...Object.values(bindings))
  const props = Vue.reactive({ types, canEdit: true, reloadTypes })
  return { props, state: component.setup(props, { expose: () => {}, emit: () => {} }) }
}

describe('WarningTypesCard revision conflicts', () => {
  it('saves with the revision the edit started from, shows the conflict, and reload resets the draft to the newer revision', async () => {
    const patch = vi.fn().mockRejectedValueOnce(new ApiError(409, 'conflict', 'changed')).mockResolvedValue(type())
    const reloadTypes = vi.fn(async () => { card.props.types = [type({ name: 'Verbal (HR)', revision: 5 })] })
    const card = mount([type()], patch, reloadTypes)
    const { state } = card

    // The edit starts at revision 4 ...
    state.setDraft(card.props.types[0], { name: 'Verbal warning' })
    // ... a background refetch delivers revision 5 (another manager renamed the type) ...
    card.props.types = [type({ name: 'Verbal (HR)', revision: 5 })]
    // ... and the save still sends 4.
    await state.saveType(card.props.types[0])
    expect(patch).toHaveBeenCalledWith({ id: 3, body: { revision: 4, name: 'Verbal warning', severity: 1 } })
    expect(state.conflict.value).toBe(true)
    expect(state.message.value).toBe('hrWarnings.types.conflict')
    expect(state.draft(card.props.types[0]).name).toBe('Verbal warning')

    // A second save is blocked until the list is reloaded.
    await state.saveType(card.props.types[0])
    expect(patch).toHaveBeenCalledTimes(1)

    await state.reload()
    expect(reloadTypes).toHaveBeenCalledTimes(1)
    expect(state.conflict.value).toBe(false)
    expect(state.draft(card.props.types[0])).toEqual({ name: 'Verbal (HR)', severity: 1, revision: 5 })
  })

  it('a new edit after the reload sends the reloaded revision', async () => {
    const patch = vi.fn().mockResolvedValue(type())
    const card = mount([type({ revision: 5 })], patch, vi.fn())
    card.state.setDraft(card.props.types[0], { severity: 3 })
    await card.state.saveType(card.props.types[0])
    expect(patch).toHaveBeenCalledWith({ id: 3, body: { revision: 5, name: 'Verbal', severity: 3 } })
    expect(card.state.draft(card.props.types[0]).revision).toBe(5)
  })
})
