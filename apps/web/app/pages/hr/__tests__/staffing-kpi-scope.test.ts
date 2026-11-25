import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import * as contracts from '@liwan/contracts'
import * as safeReturnTo from '@liwan/ui/app/utils/safeReturnTo'
import * as recruitment from '../../../composables/useHrRecruitment'
import * as warnings from '../../../composables/useHrWarnings'
import * as kpis from '../../../utils/hrStaffingKpis'

// The tiles above a filtered list must count the same narrowed set the list shows. Each page is run with its list
// filters in the URL; every request it makes goes through the composable's real query builder, so a scope the
// builder does not read (a wire name such as `job_id` instead of `jobId`) shows up here as a missing filter.
type Query = Record<string, unknown>

function runPage(file: string, routeQuery: Record<string, string>, use: Record<string, (input: unknown) => Query>) {
  const filename = resolve(import.meta.dirname, '../..', file)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const code = ts.transpileModule(compileScript(descriptor, { id: 'page', inlineTemplate: false }).content, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const component = Vue.defineComponent({ name: 'Stub', render: () => null })
  const modules: Record<string, unknown> = {
    vue: Vue,
    '@liwan/contracts': contracts,
    '@liwan/ui/app/utils/safeReturnTo': safeReturnTo,
    '@/composables/useHrRecruitment': recruitment,
    '@/composables/useHrWarnings': warnings,
    '@/utils/hrStaffingKpis': kpis,
    '@/components/hr/EmployeeSearchSelect.vue': { __esModule: true, default: component },
    '@/components/hr/warnings/WarningTable.vue': { __esModule: true, default: component },
  }
  const requests: Query[] = []
  const query = (enabled: unknown = true) => ({ data: Vue.ref(undefined), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => undefined, enabled })
  const asking = (build: (input: unknown) => Query) => (input: unknown, enabled: unknown = true) => {
    if (Vue.toValue(enabled)) requests.push(build(Vue.toValue(input)))
    return query(enabled)
  }
  const globals: Record<string, unknown> = {
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    useRoute: () => ({ path: `/${file.replace(/\.vue$/, '')}`, query: routeQuery, hash: '' }),
    useRouter: () => ({ replace: () => undefined }),
    useI18n: () => ({ t: (key: string) => key }),
    useHydrated: () => Vue.ref(true),
    useAccess: () => ({ can: () => true }),
    useKpiVisibility: () => ({ shown: Vue.ref(true) }),
    useHrWarningIssuer: () => ({ canIssue: Vue.ref(true) }),
    useHrRecruitmentJobList: () => query(),
    useHrRecruitmentStages: () => query(),
    useHrWarningTypes: () => query(),
    ...Object.fromEntries(Object.entries(use).map(([name, build]) => [name, asking(build)])),
  }
  const exports: { default?: { setup: (props: object, ctx: object) => unknown } } = {}
  new Function('require', 'exports', ...Object.keys(globals), code)((specifier: string) => {
    if (specifier in modules) return modules[specifier]
    throw new Error(`${file} imports ${specifier}; declare it in modules`)
  }, exports, ...Object.values(globals))
  const scope = Vue.effectScope()
  scope.run(() => exports.default!.setup({}, { expose: () => undefined, attrs: {}, slots: {}, emit: () => undefined }))
  scope.stop()
  return requests
}

describe('the staffing KPI tiles count the filtered list', () => {
  it('recruitment tiles carry the job and stage filters', () => {
    const requests = runPage('hr/recruitment.vue', { job_id: '4', stage_id: '9', q: 'Sara' }, {
      useHrRecruitmentApplicants: input => ({ ...recruitment.hrApplicantQuery(input as recruitment.HrApplicantInput) }),
    })
    // The list itself, then the ongoing and hired tiles; the all tile reuses the list's total.
    expect(requests).toHaveLength(3)
    for (const request of requests) expect(request).toMatchObject({ job_id: 4, stage_id: 9, q: 'Sara' })
    expect(requests.slice(1).map(request => request.status)).toEqual(['ongoing', 'hired'])
  })

  it('warning tiles carry the employee and type filters', () => {
    const requests = runPage('hr/warnings.vue', { employee_id: '7', type_id: '3' }, {
      useHrWarningList: input => ({ ...warnings.hrWarningQuery(input as warnings.HrWarningInput) }),
    })
    expect(requests).toHaveLength(4)
    for (const request of requests) expect(request).toMatchObject({ employee_id: 7, type_id: 3 })
    expect(requests.slice(1).map(request => request.state)).toEqual(['issued', 'acknowledged', 'contested'])
  })
})
