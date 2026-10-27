import * as documentNavigation from '../../../lib/documentNavigation'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { vi } from 'vitest'
import { createRouter, createMemoryHistory, type RouteLocationRaw } from 'vue-router'
import { createDocumentDraft } from '../../../lib/documentEditorDraft'
import { documentAccessPayload } from '../../../lib/documentAccess'
import { ApiError } from '../../../composables/useApi'
import * as navigation from '../../../utils/recordListOrigin'
import { joinList } from '../../../utils/listFormat'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
export const documentFixture = { id: 8, revision: 3, name: 'Policy', body: '<p>Original</p>', expiry_date: null, context: null, tags: [], file_count: 0, visibility: 'restricted' as const, active: true, write_date: '2026-10-19T00:00:00Z', allowed_actions: { update: true, archive: true, restore: false, upload_file: true, manage_access: true } }
export async function load(file: string, props: Record<string, unknown> = {}, allowed = true, options: { path?: string; bindings?: Record<string, unknown> } = {}) {
  const filename = resolve(import.meta.dirname, '../../../..', file)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/documents/:documentId/:child?', component: {} }, { path: '/account/documents/:documentId', component: {} }, { path: '/:pathMatch(.*)*', component: {} }] })
  await router.push(options.path ?? '/documents/8/edit?listOrigin=%2Fdocuments%3Fq%3Dpolicy%26offset%3D25%23list')
  const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const script = compileScript(descriptor, { id: 'documents-behavior' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const data = Vue.ref({ ...documentFixture, allowed_actions: Object.fromEntries(Object.entries(documentFixture.allowed_actions).map(([key, value]) => [key, allowed && value])) })
  const hydrated = Vue.ref(true); const pending = Vue.ref(false)
  const mutation = vi.fn(async (_value: unknown) => ({ ...data.value, name: 'Saved', revision: 4 }))
  const refetch = vi.fn(async () => ({ data: data.value })); const emit = vi.fn(); const navigate = vi.fn((_to: RouteLocationRaw) => Promise.resolve())
  const query = { data, refetch, error: Vue.ref(null), isLoading: Vue.ref(false), isFetching: Vue.ref(false) }
  const bindings = {
    _defineComponent: Vue.defineComponent, computed: Vue.computed, reactive: Vue.reactive, ref: Vue.ref, watch: Vue.watch, nextTick: Vue.nextTick,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => hydrated, useToast: () => ({ add: vi.fn() }), useAccess: () => ({ can: () => allowed }),
    useRoute: () => router.currentRoute.value, useRouter: () => router, navigateTo: navigate, useSsrQuerySeed: () => {},
    definePageMeta: () => {}, useEmployeeDocumentLink: () => ({ ...query, data: Vue.ref({ id: 3 }) }), useEmployeeDocument: () => query, useEmployeeDocuments: () => query, useDocumentFiles: () => ({ ...query, isRecovering: Vue.ref(false) }), useDocument: () => query, useUpdateDocument: () => ({ mutateAsync: mutation, isPending: pending }), useCreateDocument: () => ({ mutateAsync: mutation, isPending: pending }),
    createDocumentDraft, documentAccessPayload, ApiError, returnToQuery, joinList, ...navigation, ...documentNavigation,
    DocumentEditor: {}, DocumentMetadataFields: {}, DocumentReader: {}, DocumentFiles: {}, DocumentList: {}, ...options.bindings,
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope()
  const state = scope.run(() => component.setup(props, { emit, expose() {} }))
  const compiled = compileTemplate({ source: descriptor.template!.content, filename, id: 'documents-behavior', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(compiled.code))(Vue)
  async function rendered() {
    const nodes: { name: string; props: Record<string, any> }[] = []
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => ({ ...props, ...Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))) }), render }))
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]!))) app.component(name, Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
      return () => { nodes.push({ name, props: { ...attrs } }); return Vue.h('div', [slots.default?.(), slots.actions?.()]) }
    } }))
    await renderToString(app); return nodes
  }
  return { state, data, pending, hydrated, mutation, refetch, emit, navigate, router, rendered, stop: () => scope.stop() }
}
