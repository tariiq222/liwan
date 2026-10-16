import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import type { ProjectDetail } from '@nasq/contracts'
import * as projectCharter from '../../utils/projectCharter'
import * as charterSteps from '../../utils/charterSteps'
import { ApiError } from '../../composables/useApi'

// The charter page and its form are compiled from their SFCs with the Nuxt
// auto-imports and the query composables stubbed, so the states the approval
// flow adds (returned note, the lock while submitted, the reopen hint) are
// asserted on the real script and template without a browser.
const app = resolve(import.meta.dirname, '../..')

const EMPTY_CHARTER: ProjectDetail['charter'] = {
  code: null, type: null, owning_unit: null, sponsor: null, authority: '', rationale: '',
  objectives: [], benefits: '', scope: '', exclusions: '', high_level_requirements: '',
  deliverables: [], success: '', budget_state: 'unknown', amount: null,
  currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 },
  priority: null, assumptions: '', constraints: '', closure: '', state: 'draft',
  approval_required: false, can_review: false, submitted_by: null, submitted_at: null,
  approved_by: null, approved_at: null, return_note: '',
}

function project(charter: Partial<ProjectDetail['charter']> = {}): ProjectDetail {
  return {
    id: 3, name: 'Portal', status: null, progress: 0, task_count: 0, closed_task_count: 0,
    active: true, can_manage: true, allowed_actions: ['read', 'write', 'archive'], stages: [],
    charter_state: charter.state ?? 'draft', description_html: '', manager: null, privacy_visibility: 'employees',
    date_start: '2030-01-01', date_end: null, tags: [], followers_count: 0, milestone_count: 0,
    allow_task_dependencies: false, completion_approval: 'none', completion_approver: null,
    updated_at: 'v4', charter: { ...EMPTY_CHARTER, ...charter },
  }
}

const Stub = (name: string) => Vue.defineComponent({
  name,
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => Vue.h('div', { ...attrs, 'data-stub': name }, Object.values(slots).map(slot => slot?.()))
  },
})

const UAlert = Vue.defineComponent({
  inheritAttrs: false,
  props: { title: String, description: String },
  setup(props, { attrs }) { return () => Vue.h('div', attrs, [props.title, props.description]) },
})

function loadSfc(path: string, modules: Record<string, unknown>, globals: Record<string, unknown>): Vue.Component {
  const filename = resolve(app, path)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const compiled = compileScript(descriptor, { id: 'charter-approval-page', inlineTemplate: true }).content
  const code = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const stubbedVue = {
    ...Vue,
    resolveComponent: (name: string) => (name === 'UAlert' ? UAlert : Stub(name)),
  }
  const require = (specifier: string): unknown => {
    if (specifier === 'vue') return stubbedVue
    if (specifier in modules) return modules[specifier]
    throw new Error(`${path} imports ${specifier}; stub it in the test`)
  }
  const autoImports: Record<string, unknown> = {
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key }),
    useHydrated: () => Vue.ref(true),
    useToast: () => ({ add: () => {} }),
    ...globals,
  }
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', ...Object.keys(autoImports), code)(require, exports, ...Object.values(autoImports))
  return exports.default!
}

function route(query: Record<string, string> = {}) {
  return { useRoute: () => ({ params: { id: '3' }, query, path: '/projects/3/charter' }), useRouter: () => ({ push: () => {}, replace: () => {} }) }
}

const FormStub = Vue.defineComponent({
  inheritAttrs: false,
  props: { readonly: Boolean },
  setup(props, { slots }) {
    return () => Vue.h('div', { 'data-testid': 'form-stub', 'data-readonly': String(props.readonly) }, [slots.state?.(), slots.actions?.()])
  },
})

async function renderPage(detail: ProjectDetail, query: Record<string, string>) {
  const page = loadSfc('pages/projects/[id]/charter.vue', {
    '@/composables/useApi': { ApiError },
    '@/composables/useProjects': { useProject: () => ({ data: Vue.ref(detail), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => {} }) },
    '@/composables/useMilestones': { useMilestones: () => ({ data: Vue.ref([]), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => {} }) },
    '@/components/pmo/projects/ProjectCharterForm.vue': { __esModule: true, default: FormStub },
    '@/components/pmo/projects/CharterApprovalPanel.vue': { __esModule: true, default: Stub('CharterApprovalPanel') },
  }, route(query))
  return renderToString(Vue.createSSRApp(page))
}

async function renderForm(detail: ProjectDetail) {
  const pending = { mutateAsync: async () => ({}), isPending: Vue.ref(false) }
  const form = loadSfc('components/pmo/projects/ProjectCharterForm.vue', {
    '@/composables/useApi': { ApiError },
    '@/composables/useProjects': {
      isStaleProjectWrite: () => false,
      useCharterTransition: () => pending,
      useCreateProject: () => pending,
      useUpdateProject: () => pending,
      useProject: () => ({ data: Vue.ref(detail), isFetching: Vue.ref(false) }),
    },
    '@/composables/useProjectCharterCatalogs': { useCharterDefaults: () => ({ data: Vue.ref(null) }) },
    '@/utils/projectCharter': projectCharter,
    '@/utils/charterSteps': charterSteps,
    // The AI draft helpers are not exercised by the save-hint tests: an edit form has neither a draft nor an attestation.
    '@/utils/aiDraft': { charterDraftFromAi: (_payload: unknown, base: unknown) => base, mayFinalizeCreate: () => true },
    '@/components/pmo/projects/ProjectCharterFields.vue': { __esModule: true, default: Stub('ProjectCharterFields') },
    '@/components/pmo/projects/ProjectCharterDisplay.vue': { __esModule: true, default: Stub('ProjectCharterDisplay') },
  }, { ...route(), useMe: () => ({ me: Vue.ref({ id: 1 }) }) })
  return renderToString(Vue.createSSRApp(form, { mode: 'edit', project: detail }))
}

describe('the charter page under approval', () => {
  it('shows the sponsor note on a returned draft being edited', async () => {
    const html = await renderPage(project({ state: 'draft', return_note: 'Scope is unclear' }), { edit: '1' })
    expect(html).toContain('data-testid="charter-returned"')
    expect(html).toContain('Scope is unclear')
    expect(html).toContain('data-readonly="false"')
  })

  it('shows no returned note on a draft that was never returned', async () => {
    const html = await renderPage(project({ state: 'draft' }), { edit: '1' })
    expect(html).not.toContain('data-testid="charter-returned"')
  })

  it('keeps a submitted charter read-only even when the URL asks to edit', async () => {
    const html = await renderPage(project({ state: 'submitted', approval_required: true }), { edit: '1' })
    expect(html).toContain('data-stub="SharedStandalonePage"')
    expect(html).not.toContain('data-stub="SharedPageContainer"')
    expect(html).toContain('data-readonly="true"')
    expect(html).not.toContain('data-testid="project-charter-edit"')
  })

  it('opens the editor for a draft when the URL asks to edit', async () => {
    const html = await renderPage(project({ state: 'draft' }), { edit: '1' })
    expect(html).toContain('data-stub="SharedPageContainer"')
  })
})

describe('the charter form save hint', () => {
  it('warns that saving reopens an approved charter when approval is required', async () => {
    const html = await renderForm(project({ state: 'approved', approval_required: true }))
    expect(html).toContain('data-testid="charter-save-reopens-hint"')
  })

  it('says nothing when approval is not required or the charter is not approved', async () => {
    expect(await renderForm(project({ state: 'approved', approval_required: false }))).not.toContain('charter-save-reopens-hint')
    expect(await renderForm(project({ state: 'draft', approval_required: true }))).not.toContain('charter-save-reopens-hint')
  })
})
