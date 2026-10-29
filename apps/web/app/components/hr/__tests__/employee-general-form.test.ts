import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import ts from 'typescript'
import { saveErrorMessage } from '../../../utils/formFeedback'
import { ApiError } from '../../../composables/useApi'
import { hrManagerOptions, type HrEmployee } from '../../../composables/useHrEmployees'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../EmployeeGeneralForm.vue')
const source = readFileSync(filename, 'utf8')

function loadComponent() {
  const script = compileScript(parse(source, { filename }).descriptor, { id: 'employee-general-form-test' }).content
  const code = ts.transpileModule(script, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as Record<string, unknown> }
  const createMutation = () => ({ mutateAsync: async () => ({}), isPending: Vue.ref(false) })
  const selectedManager = Vue.computed(() => ({ id: 99, name: 'Current manager' } as Pick<HrEmployee, 'id' | 'name'>))
  const useHrEmployees = () => ({
    data: Vue.ref({ items: [{ id: 1, name: 'First page employee' }], total: 1 }),
    isFetching: Vue.ref(false),
    error: Vue.ref(null),
    refetch: () => Promise.resolve(),
  })
  const require = (name: string) => {
    if (name === 'vue') return Vue
    if (name === '@/utils/formFeedback') return { saveErrorMessage }
    if (name === '@/composables/useApi') return { ApiError }
    if (name === '@/composables/useHrCountries') return { useHrCountries: () => ({ data: Vue.ref({ items: [{ id: 192, name: 'Saudi Arabia', code: 'SA' }], total: 1 }), isFetching: Vue.ref(false) }) }
    if (name === '@vueuse/core') return { refDebounced: (value: Vue.Ref<string>) => value }
    if (name === '@/composables/useHrEmployees') return {
      useCreateHrEmployee: createMutation,
      useUpdateHrEmployee: createMutation,
      useHrEmployees,
      useHrEmployee: () => ({ data: selectedManager, error: Vue.ref(null), refetch: () => Promise.resolve() }),
      hrManagerOptions,
      retryHrManagerQueries: () => {},
    }
    throw new Error(`Unexpected import: ${name}`)
  }
  new Function('require', 'module', 'exports', 'useI18n', 'useHydrated', 'useAccess', 'useToast', 'ref', 'computed', 'watch', code)(
    require,
    module,
    module.exports,
    () => ({ t: (key: string) => key }),
    () => Vue.ref(true),
    () => ({ can: () => true }),
    () => ({ add: () => {} }),
    Vue.ref,
    Vue.computed,
    Vue.watch,
  )
  return module.exports.default as { setup: (props: unknown, context: unknown) => Record<string, unknown> }
}

describe('EmployeeGeneralForm production setup', () => {
  it('keeps the selected remote manager in the consumer options when it is outside the first page', () => {
    const component = loadComponent()
    const props = Vue.reactive({
      employee: {
        id: 7,
        name: 'Employee',
        work_email: '',
        work_phone: '',
        job_title: '',
        department: null,
        manager: { id: 99, name: 'Current manager' },
        nationality: { id: 66, name: 'Egypt' },
        access: null,
      },
      departments: [],
      employees: [{ id: 1, name: 'First page employee' }],
    })
    const state = component.setup(props, { emit: () => {}, expose: () => {} })
    const options = (state.managerOptions as Vue.ComputedRef<Array<{ id: number; name: string }>>).value
    expect(options.map(option => option.id)).toContain(99)
  })

  it('offers the saved nationality beside the searched countries and loads it into the form state', () => {
    const component = loadComponent()
    const props = Vue.reactive({
      employee: {
        id: 7, name: 'Employee', work_email: '', work_phone: '', job_title: '', department: null,
        manager: null, nationality: { id: 66, name: 'Egypt' }, access: null,
      },
      departments: [],
      employees: [],
    })
    const state = component.setup(props, { emit: () => {}, expose: () => {} })
    const items = (state.countryItems as Vue.ComputedRef<Array<{ value: number; label: string }>>).value
    expect(items).toEqual([{ value: 66, label: 'Egypt' }, { value: 192, label: 'Saudi Arabia' }])
    expect((state.nationalityId as Vue.Ref<number | null>).value).toBe(66)
  })
  it('accepts the number a number input emits for the notice period', () => {
    const component = loadComponent()
    const props = Vue.reactive({ employee: null, departments: [], employees: [] })
    const state = component.setup(props, { emit: () => {}, expose: () => {} })
    const notice = state.noticeDays as Vue.Ref<string | number>
    const valid = state.noticeValid as Vue.ComputedRef<boolean>
    notice.value = 30
    expect(valid.value).toBe(true)
    notice.value = ''
    expect(valid.value).toBe(false)
  })
})
