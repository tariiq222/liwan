import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { hrManagerOptions } from '../../../../composables/useHrEmployees'

// The employee is found by a server search a page at a time, and the chosen employee is looked up by id,
// so the choice stays in the list when it is not among the matches.
const FILE = resolve(import.meta.dirname, '../EnrollmentForm.vue')

function mount() {
  const descriptor = parse(readFileSync(FILE, 'utf8'), { filename: FILE }).descriptor
  const script = compileScript(descriptor, { id: 'enrollment-form' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const asked: Array<Record<string, unknown>> = []
  const found = Vue.ref({ items: [{ id: 1, name: 'Amal' }], total: 120 })
  const selected = Vue.ref<{ id: number; name: string } | undefined>(undefined)
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, nextTick: Vue.nextTick,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true),
    refDebounced: (value: Vue.Ref<string>) => value,
    useHrEmployees: (params: Vue.ComputedRef<Record<string, unknown>>) => ({ data: Vue.computed(() => { asked.push(params.value); return found.value }) }),
    useHrEmployee: () => ({ data: selected }),
    hrManagerOptions, useCreateHrInsuranceEnrollment: () => ({ mutateAsync: async () => undefined, isPending: Vue.ref(false) }), ApiError: class {},
  }
  const component = new Function(...Object.keys(bindings), ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText)(...Object.values(bindings))
  const state = component.setup(Vue.reactive({ plans: [], backTo: '/hr/insurance' }), { expose: () => {}, emit: () => {} })
  return { state, asked, found, selected }
}

describe('EnrollmentForm employee picker', () => {
  it('asks the server for one page of matches and tells when there are more', () => {
    const { state, asked } = mount()
    expect(state.employeeOptions.value).toEqual([{ value: '1', label: 'Amal' }])
    expect(asked.at(-1)).toEqual({ q: undefined, limit: 50 })
    expect(state.moreEmployees.value).toBe(true)
    state.employeeSearch.value = ' Noura '
    state.employeeOptions.value
    expect(asked.at(-1)).toEqual({ q: 'Noura', limit: 50 })
  })

  it('keeps the chosen employee in the options even when the search does not return it', () => {
    const { state, selected } = mount()
    state.employeeId.value = 77
    selected.value = { id: 77, name: 'Zainab' }
    state.employeeSearch.value = 'Am'
    expect(state.employeeOptions.value.map((option: { label: string }) => option.label).sort()).toEqual(['Amal', 'Zainab'])
  })
})
