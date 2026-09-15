import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import ts from 'typescript'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../documents.vue')
const source = readFileSync(filename, 'utf8')

function loadPage() {
  const script = compileScript(parse(source, { filename }).descriptor, { id: 'documents-index-behavior-test' }).content
  const code = ts.transpileModule(script, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as Record<string, unknown> }
  const route = {
    path: '/hr/documents',
    query: Vue.reactive<Record<string, string>>({ q: 'term', department_id: '2', offset: '25' }),
    fullPath: '/hr/documents?q=term&department_id=2&offset=25',
  }
  const replacements: Array<{ query: Record<string, unknown> }> = []
  const router = {
    replace: (location: { query: Record<string, unknown> }) => {
      replacements.push(location)
      return Promise.resolve()
    },
  }
  let documentParams: Vue.ComputedRef<Record<string, unknown>> | undefined
  const require = (name: string) => {
    if (name === 'vue') return Vue
    if (name === '@/components/shared/FilterBar.vue') return {}
    if (name === '@/components/shared/RecordNumber.vue') return {}
    if (name === '@vueuse/core') return { refDebounced: (value: Vue.Ref<string>) => value }
    if (name === '@/composables/useHrDocuments') return {
      useHrDocuments: (params: Vue.ComputedRef<Record<string, unknown>>) => {
        documentParams = params
        return {
          data: Vue.ref({ items: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })), total: 50 }),
          isFetching: Vue.ref(false),
          isLoading: Vue.ref(false),
          error: Vue.ref(null),
          refetch: () => Promise.resolve(),
        }
      },
    }
    if (name === '@/composables/useHrDepartments') return {
      useHrDepartments: () => ({ data: Vue.ref({ items: [] }), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => Promise.resolve() }),
    }
    if (name === '@/utils/safeReturnTo') return { returnToQuery: () => ({}) }
    if (name === '@/composables/useHrSearch') return {
      hasPendingHrSearch: () => false,
      hrCommittedListParams: (query: Record<string, unknown>) => ({
        q: typeof query.q === 'string' ? query.q : undefined,
        offset: Math.max(0, Number(query.offset ?? 0) || 0),
      }),
    }
    throw new Error(`Unexpected import: ${name}`)
  }
  new Function('require', 'module', 'exports', 'useRoute', 'useRouter', 'useI18n', 'useHydrated', 'useAccess', 'ref', 'computed', 'watch', 'navigateTo', code)(
    require,
    module,
    module.exports,
    () => route,
    () => router,
    () => ({ t: (key: string) => key }),
    () => Vue.ref(true),
    () => ({ can: () => true }),
    Vue.ref,
    Vue.computed,
    Vue.watch,
    () => Promise.resolve(),
  )
  return {
    page: module.exports.default as { setup: (props: unknown, context: unknown) => Record<string, unknown> },
    route,
    replacements,
    get documentParams() { return documentParams }
  }
}

describe('HR documents page route consumers', () => {
  it('clears the committed offset when returning to the first page', () => {
    const loaded = loadPage()
    const state = loaded.page.setup({}, { emit: () => {}, expose: () => {} })

    ;(state.setPage as (page: number) => void)(1)

    expect(loaded.replacements[0]?.query.offset).toBeUndefined()
  })

  it('keeps document requests on committed route filters while a department change is pending', async () => {
    const loaded = loadPage()
    const state = loaded.page.setup({}, { emit: () => {}, expose: () => {} })

    ;(state.onDepartmentChange as (value: unknown) => void)('3')
    await Vue.nextTick()

    expect(loaded.documentParams?.value.department_id).toBe(2)
    expect(loaded.documentParams?.value.offset).toBe(25)
  })
})
