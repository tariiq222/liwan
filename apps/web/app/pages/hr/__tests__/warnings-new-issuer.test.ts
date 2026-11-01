import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, fakeT, loadShared } from '@liwan/ui/test/helpers/renderShared'

// The warning create panel opens on the server's `can_issue`, not on a capability: a direct manager has none of
// hr.warnings.*, so under the HR-only policy the panel is the forbidden state and under the manager policy it shows the form.
// The settings answer below is what GET /warnings/settings sends each caller in each mode.
type Settings = { warnings_issued_by: 'hr_only' | 'manager_and_hr'; can_issue: boolean }
const FORM = Vue.defineComponent({ name: 'WarningForm', props: ['employees'], setup: props => () => Vue.h('form', { 'data-stub': 'WarningForm', 'data-employees': (props.employees as unknown[]).length }) })

function loadPage(settings: Settings | undefined, can: (capability: string) => boolean): Vue.Component {
  const filename = resolve(import.meta.dirname, '../warnings/new.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const code = ts.transpileModule(compileScript(descriptor, { id: 'page', inlineTemplate: true }).content, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const modules: Record<string, unknown> = {
    vue: Vue,
    '@/components/hr/warnings/WarningForm.vue': { __esModule: true, default: FORM },
    '@/utils/recordListOrigin': { owningListBack: () => '/hr/warnings' },
  }
  const query = (data: unknown) => ({ data: Vue.ref(data), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => undefined })
  const globals: Record<string, unknown> = {
    ref: Vue.ref, computed: Vue.computed,
    useI18n: () => ({ t: fakeT() }),
    useAccess: () => ({ can }),
    useRoute: () => ({ query: {}, hash: '' }),
    useRouter: () => ({ resolve: () => ({ fullPath: '/hr/warnings' }) }),
    useRecordListPaths: () => Vue.ref(['/hr/warnings']),
    navigateTo: () => undefined,
    useHrWarningIssuer: () => ({ canIssue: Vue.computed(() => settings?.can_issue === true), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => undefined }),
    useHrWarningTypes: () => query({ items: [{ id: 1, name: 'Verbal', severity: 1, active: true, revision: 1 }], total: 1 }),
    useHrWarningCandidates: () => query({ items: [{ id: 7, name: 'Noura' }], total: 1 }),
  }
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', ...Object.keys(globals), code)((specifier: string) => {
    if (specifier in modules) return modules[specifier]
    throw new Error(`warnings/new.vue imports ${specifier}; declare it in modules`)
  }, exports, ...Object.values(globals))
  return exports.default!
}

const layout = Vue.defineComponent({ inheritAttrs: false, setup(_, { slots }) { return () => Vue.h('section', slots.default?.()) } })

async function render(settings: Settings | undefined, can: (capability: string) => boolean) {
  const app = Vue.createSSRApp({ render: () => Vue.h(loadPage(settings, can)) })
  app.config.globalProperties.$t = fakeT() as never
  const real = { SharedForbiddenState: loadShared('ForbiddenState') }
  for (const [tag, stub] of Object.entries({ ...DEFAULT_STUBS, SharedCreatePanel: layout, SharedPageState: layout, ...real })) app.component(tag, stub)
  return renderToString(app)
}

describe('the warning create panel follows the server issuer flag', () => {
  const manager = (capability: string) => capability === 'hr.employees.read'
  const hr = (capability: string) => ['hr.employees.read', 'hr.warnings.read', 'hr.warnings.manage'].includes(capability)

  it('hides the panel from a direct manager under the HR-only policy', async () => {
    const html = await render({ warnings_issued_by: 'hr_only', can_issue: false }, manager)
    expect(html).toContain('data-slot="forbidden-state"')
    expect(html).not.toContain('data-stub="WarningForm"')
  })

  it('shows the form to a direct manager under the manager policy, with his reports as candidates', async () => {
    const html = await render({ warnings_issued_by: 'manager_and_hr', can_issue: true }, manager)
    expect(html).not.toContain('data-slot="forbidden-state"')
    expect(html).toContain('data-stub="WarningForm"')
    expect(html).toContain('data-employees="1"')
  })

  it('shows the form to HR in both modes', async () => {
    for (const mode of ['hr_only', 'manager_and_hr'] as const) {
      expect(await render({ warnings_issued_by: mode, can_issue: true }, hr)).toContain('data-stub="WarningForm"')
    }
  })

  it('stays closed while the flag is unknown', async () => {
    expect(await render(undefined, hr)).toContain('data-slot="forbidden-state"')
  })
})
