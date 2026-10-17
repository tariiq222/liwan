import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createHooks } from 'hookable'
import ts from 'typescript'
import { hasPendingHrSearch, hrCommittedListParams } from '../../../composables/useHrSearch'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'

const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()) })
async function loadPage() {
  const filename = resolve(import.meta.dirname, '../documents.vue')
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'documents-index-behavior-test' }).content
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} as Record<string, unknown> }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/hr/documents', component: {} }] })
  await router.push('/hr/documents?q=term&department_id=2&offset=25')
  const route = Vue.reactive({
    get path() { return router.currentRoute.value.path }, get query() { return router.currentRoute.value.query },
    get fullPath() { return router.currentRoute.value.fullPath }, get hash() { return router.currentRoute.value.hash },
  })
  const hooks = createHooks()
  router.beforeEach(to => hooks.callHook('webvue:navigation:start', to))
  const replace = vi.spyOn(router, 'replace')
  let documentParams: Vue.ComputedRef<Record<string, unknown>> | undefined
  const require = (name: string) => {
    if (name === 'vue') return Vue
    if (name === '@webvue/ui/app/components/shared/data/FilterBar.vue' || name === '@webvue/ui/app/components/shared/data/RecordNumber.vue' || name === '@webvue/ui/app/utils/recordNumberHeader') return {}
    if (name === '@vueuse/core') return { refDebounced: (value: Vue.Ref<string>) => value }
    if (name === '@/composables/useHrDocuments') return { useHrDocuments: (params: Vue.ComputedRef<Record<string, unknown>>) => {
      documentParams = params
      return { data: Vue.ref({ items: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })), total: 50 }), isFetching: Vue.ref(false), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => Promise.resolve() }
    } }
    if (name === '@/composables/useHrDepartments') return { useHrDepartments: () => ({ data: Vue.ref({ items: [] }), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => Promise.resolve() }) }
    if (name === '@webvue/ui/app/utils/safeReturnTo') return { returnToQuery }
    if (name === '@/composables/useHrSearch') return { hasPendingHrSearch, hrCommittedListParams }
    throw new Error(`Unexpected import: ${name}`)
  }
  const bindings = { require, module, exports: module.exports, useRoute: () => route, useRouter: () => router, useNuxtApp: () => ({ hook: hooks.hook }), useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useAccess: () => ({ can: () => true }), ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, onScopeDispose: Vue.onScopeDispose }
  new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const scope = Vue.effectScope()
  const page = module.exports.default as { setup: (props: unknown, context: unknown) => Record<string, unknown> }
  const state = scope.run(() => page.setup({}, { emit: () => {}, expose: () => {} }))!
  cleanups.push(() => scope.stop())
  return { state, route, router, replace, get documentParams() { return documentParams } }
}

describe('HR documents page route consumers', () => {
  it('clears the committed offset when returning to the first page', async () => {
    const loaded = await loadPage()
    ;(loaded.state.setPage as (page: number) => void)(1)
    expect(loaded.replace.mock.calls[0]?.[0]).toMatchObject({ query: { offset: undefined } })
    await expect.poll(() => loaded.route.query.offset).toBeUndefined()
  })
  it('keeps document requests on committed route filters while a department change is pending', async () => {
    const loaded = await loadPage()
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    loaded.router.beforeResolve(() => pending)
    try {
      ;(loaded.state.onDepartmentChange as (value: unknown) => void)('3')
      await Vue.nextTick()
      expect(loaded.documentParams?.value.department_id).toBe(2)
      expect(loaded.documentParams?.value.offset).toBe(25)
      expect(loaded.replace.mock.calls[0]?.[0]).toMatchObject({ query: { department_id: 3, offset: undefined } })
    } finally { release() }
    await expect.poll(() => loaded.route.query.department_id).toBe('3')
    expect(loaded.documentParams?.value.offset).toBe(0)
  })
})
