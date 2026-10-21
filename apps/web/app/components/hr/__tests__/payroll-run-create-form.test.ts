import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HrPayrollRunCreateSchema } from '@webvue/contracts'
import { ApiError } from '../../../composables/useApi'
import { saveErrorMessage } from '../../../utils/formFeedback'
import { normalizeDigits } from '../../../utils/moneyInput'
import { currentPayrollMonth } from '../../../utils/payrollFormat'

// Runs the form's real <script setup> without the DOM (the same harness idea as compensation-form.test.ts); the
// mounted hook is captured instead of run so the test can tell the server render from the first client render.
const filename = resolve(import.meta.dirname, '../payroll/PayrollRunCreateForm.vue')

function load() {
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'payroll-run-create-form' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const mounted: Array<() => void> = []
  const createRun = vi.fn(async (_body: unknown) => ({ id: 1 }))
  const emit = vi.fn()
  const bindings = {
    _defineComponent: Vue.defineComponent, computed: Vue.computed, ref: Vue.ref, nextTick: Vue.nextTick,
    onMounted: (hook: () => void) => { mounted.push(hook) },
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true),
    useCreateHrPayrollRun: () => ({ mutateAsync: createRun, isPending: Vue.ref(false) }),
    HrPayrollRunCreateSchema, ApiError, saveErrorMessage, normalizeDigits, currentPayrollMonth,
  }
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const state = component.setup(Vue.reactive({ backTo: '/hr/payroll' }), { expose: () => {}, emit })
  return { state, mounted, createRun }
}

const localMonth = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

afterEach(() => { vi.useRealTimers() })

describe('PayrollRunCreateForm default month', () => {
  it('leaves the month empty for the server render and fills it from the browser clock after mount', () => {
    const { state, mounted } = load()
    expect(state.month.value).toBe('')
    expect(state.dirty.value).toBe(false)
    mounted.forEach(hook => hook())
    expect(state.month.value).toBe(currentPayrollMonth())
    expect(state.initialMonth.value).toBe(currentPayrollMonth())
  })

  it('reads the default month from the browser own calendar, never the UTC month', () => {
    const local = new Date(2026, 2, 1, 0, 30)
    vi.useFakeTimers()
    vi.setSystemTime(local)
    const { state, mounted } = load()
    mounted.forEach(hook => hook())
    expect(state.month.value).toBe(localMonth(local))
    // An instant that falls in another month in UTC must still give the local month.
    if (local.getMonth() !== local.getUTCMonth()) {
      expect(state.month.value).not.toBe(`${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`)
    }
  })

  it('marks the form dirty only once the user changes the month, and clean again when it comes back', () => {
    const { state, mounted } = load()
    mounted.forEach(hook => hook())
    expect(state.dirty.value).toBe(false)
    state.month.value = '2026-05'
    expect(state.dirty.value).toBe(true)
    state.month.value = state.initialMonth.value
    expect(state.dirty.value).toBe(false)
  })

  it('submits the chosen month', async () => {
    const { state, mounted, createRun } = load()
    mounted.forEach(hook => hook())
    state.month.value = '2026-05'
    await state.submit()
    expect(createRun).toHaveBeenCalledWith({ month: '2026-05' })
  })
})
