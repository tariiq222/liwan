import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createHooks } from 'hookable'
import ts from 'typescript'
import { hasPendingDocumentSearch, documentCommittedListParams } from '../../../lib/documentKeys'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'

const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()) })
async function loadPage(allowed = true) {
  const filename = resolve(import.meta.dirname, '../../documents.vue')
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'documents-index-behavior-test' }).content
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} as Record<string, unknown> }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/documents', component: {} }] })
  await router.push('/documents?q=term&context_kind=hr.department&context_id=2&offset=25')
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
    if (name === '@/components/documents/DocumentList.vue') return {}
    if (name === '@/composables/useDocuments') return { useDocumentContexts: () => ({ data: Vue.ref({ items: [{ kind: 'hr.department', label: 'Department' }] }) }), useDocumentContextOptions: () => ({ data: Vue.ref({ items: [] }) }), useDocuments: (params: Vue.ComputedRef<Record<string, unknown>>) => {
      documentParams = params
      return { data: Vue.ref({ items: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })), total: 50 }), isFetching: Vue.ref(false), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => Promise.resolve() }
    } }
    if (name === '@webvue/ui/app/utils/safeReturnTo') return { returnToQuery }
    if (name === '@/lib/documentKeys') return { hasPendingDocumentSearch, documentCommittedListParams }
    throw new Error(`Unexpected import: ${name}`)
  }
  const bindings = { require, module, exports: module.exports, useRoute: () => route, useRouter: () => router, useNuxtApp: () => ({ hook: hooks.hook }), useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useAccess: () => ({ can: (capability: string) => capability === 'documents.items.manage' ? allowed : true }), ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, onScopeDispose: Vue.onScopeDispose }
  new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const scope = Vue.effectScope()
  const page = module.exports.default as { setup: (props: unknown, context: unknown) => Record<string, unknown> }
  const state = scope.run(() => page.setup({}, { emit: () => {}, expose: () => {} }))!
  cleanups.push(() => scope.stop())
  return { state, route, router, replace, get documentParams() { return documentParams } }
}

describe('Documents page route consumers', () => {
  it('recognizes the canonical list route', async () => { const loaded = await loadPage(); expect((loaded.state.isListRoute as Vue.ComputedRef<boolean>).value).toBe(true) })
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
      ;(loaded.state.onContextChange as (value: unknown) => void)('3')
      await Vue.nextTick()
      expect(loaded.documentParams?.value.context_id).toBe(2)
      expect(loaded.documentParams?.value.offset).toBe(25)
      expect(loaded.replace.mock.calls[0]?.[0]).toMatchObject({ query: { context_id: 3, offset: undefined } })
    } finally { release() }
    await expect.poll(() => loaded.route.query.context_id).toBe('3')
    expect(loaded.documentParams?.value.offset).toBe(0)
  })
})

it('does not offer context options without document management capability', async () => { const loaded = await loadPage(false); expect((loaded.state.provider as Vue.ComputedRef<string | null>).value).toBeNull() })
it('never sends a half-selected context to the paired-filter API', async () => {
  const loaded = await loadPage()
  ;(loaded.state.onKindChange as (value: string) => void)('hr.department')
  await expect.poll(() => loaded.route.query.context_id).toBeUndefined()
  expect(loaded.documentParams?.value.context_id).toBeUndefined()
  expect(loaded.documentParams?.value.context_kind).toBeUndefined()
})

it('makes a selected context kind clearable even before a record is chosen',async()=>{
 const loaded=await loadPage()
 await loaded.router.push('/documents?context_kind=hr.department')
 await Vue.nextTick()
 expect((loaded.state.activeFilterCount as Vue.ComputedRef<number>).value).toBe(1)
 ;(loaded.state.clearFilters as ()=>void)()
 await expect.poll(()=>loaded.route.query.context_kind).toBeUndefined()
 expect((loaded.state.activeFilterCount as Vue.ComputedRef<number>).value).toBe(0)
})
