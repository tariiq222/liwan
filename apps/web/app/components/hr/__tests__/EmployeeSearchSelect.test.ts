import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { hrManagerOptions } from '../../../composables/useHrEmployees'

// The employee filter asks the server for one page of matches and looks the chosen employee up by id,
// so an employee beyond the first page can be searched, chosen and kept in the list.
const FILE = resolve(import.meta.dirname, '../EmployeeSearchSelect.vue')

function mount(modelValue: number | null) {
  const descriptor = parse(readFileSync(FILE, 'utf8'), { filename: FILE }).descriptor
  const script = compileScript(descriptor, { id: 'employee-search-select' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const asked: Array<Record<string, unknown>> = []
  const found = Vue.ref({ items: [{ id: 1, name: 'Amal' }], total: 300 })
  const selected = Vue.ref<{ id: number; name: string } | undefined>(undefined)
  const emit = vi.fn()
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, useI18n: () => ({ t: (key: string) => key }),
    refDebounced: (value: Vue.Ref<string>) => value, hrManagerOptions,
    useHrEmployees: (params: Vue.ComputedRef<Record<string, unknown>>) => ({ data: Vue.computed(() => { asked.push(params.value); return found.value }) }),
    useHrEmployee: () => ({ data: selected }),
  }
  const component = new Function(...Object.keys(bindings), ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText)(...Object.values(bindings))
  const props = Vue.reactive({ modelValue, anyLabel: 'All employees', id: 'x' })
  return { state: component.setup(props, { expose: () => {}, emit }), asked, selected, props, emit }
}

describe('EmployeeSearchSelect', () => {
  it('searches the server by name a page at a time, with the no-filter item first', () => {
    const { state, asked } = mount(null)
    expect(state.items.value).toEqual([{ value: 'all', label: 'All employees' }, { value: '1', label: 'Amal' }])
    expect(asked.at(-1)).toEqual({ q: undefined, limit: 50 })
    expect(state.more.value).toBe(true)
    state.search.value = ' Zainab '
    state.items.value
    expect(asked.at(-1)).toEqual({ q: 'Zainab', limit: 50 })
  })

  it('keeps a chosen employee beyond the first page in the options', () => {
    const { state, selected } = mount(250)
    selected.value = { id: 250, name: 'Zainab' }
    expect(state.items.value.map((item: { label: string }) => item.label)).toEqual(['All employees', 'Amal', 'Zainab'])
  })
})
