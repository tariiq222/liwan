import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, fakeT, loadShared } from '@webvue/ui/test/helpers/renderShared'

// Every HR create/edit page gated on a capability renders the shared 403 state
// (role="alert") when the caller lacks it, never an empty state (role="status").
// Rendered test: each page's real <script setup> and template are compiled and rendered
// to HTML (SSR) with the real SharedForbiddenState and SharedEmptyState from packages/ui.
// The page's form, SharedPageState and the data composables are declared stand-ins below;
// none of them feeds the capability gate under test. An import that is not declared here
// fails the test instead of being filled in silently.
const PAGES: [file: string, capability: string, description?: string][] = [
  ['assets/new.vue', 'hr.assets.manage'],
  ['assets/categories/new.vue', 'hr.assets.manage'],
  ['departments/new.vue', 'hr.departments.manage'],
  ['departments/[departmentId]/edit.vue', 'hr.departments.manage'],
  ['employees/new.vue', 'hr.employees.manage'],
  ['employees/[employeeId]/edit.vue', 'hr.employees.manage'],
  ['employees/[employeeId]/compensation.vue', 'hr.payroll.manage', 'hrPayroll.compensation.forbidden'],
  ['leave/allocations/new.vue', 'hr.leave.manage'],
  ['leave/allocations/index.vue', 'hr.leave.manage'],
  ['leave/allocations/[allocationId].vue', 'hr.leave.manage'],
  ['shifts/assignments/[assignmentId].vue', 'hr.shifts.read'],
  ['offboarding/new.vue', 'hr.offboarding.manage', 'hrOffboarding.errors.forbidden'],
  ['offboarding/plans/new.vue', 'hr.offboarding.manage', 'hrOffboarding.errors.forbidden'],
  ['onboarding/new.vue', 'hr.onboarding.manage', 'hrOnboarding.errors.forbidden'],
  ['onboarding/plans/new.vue', 'hr.onboarding.manage', 'hrOnboarding.errors.forbidden'],
  ['payroll/new.vue', 'hr.payroll.manage'],
  ['recruitment/new.vue', 'hr.recruitment.manage'],
  ['recruitment/jobs/new.vue', 'hr.recruitment.manage'],
  ['self/leave/new.vue', 'hr.leave.request'],
  ['shifts/new.vue', 'hr.shifts.manage'],
  ['shifts/schedules/new.vue', 'hr.shifts.manage'],
]

const Stub = (name: string) => Vue.defineComponent({
  name, inheritAttrs: false,
  setup(_, { slots }) { return () => Vue.h('div', { 'data-stub': name }, slots.default?.()) },
})
const query = () => ({ data: Vue.ref(undefined), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => undefined })
const mutation = () => ({ mutateAsync: async () => undefined, isPending: Vue.ref(false) })
const component = (name: string) => ({ __esModule: true, default: Stub(name) })

const MODULES: Record<string, unknown> = {
  'vue': Vue,
  '@/components/hr/payroll/CompensationForm.vue': component('CompensationForm'),
  '@/components/hr/DepartmentForm.vue': component('DepartmentForm'),
  '@/components/hr/lifecycle/DepartureForm.vue': component('DepartureForm'),
  '@/components/hr/EmployeeGeneralForm.vue': component('EmployeeGeneralForm'),
  '@/components/hr/assets/EquipmentForm.vue': component('EquipmentForm'),
  '@/components/hr/LeaveAllocationForm.vue': component('LeaveAllocationForm'),
  '@/components/hr/LeaveRequestForm.vue': component('LeaveRequestForm'),
  '@/components/hr/payroll/PayrollRunCreateForm.vue': component('PayrollRunCreateForm'),
  '@/components/hr/lifecycle/PlanForm.vue': component('PlanForm'),
  '@/components/hr/shifts/ShiftAssignmentForm.vue': component('ShiftAssignmentForm'),
  '@/components/hr/shifts/ShiftScheduleForm.vue': component('ShiftScheduleForm'),
  '@/composables/useApi': { ApiError: class ApiError extends Error {} },
  '@/modules/hr/navigation': { EMPLOYEE_LIST_PATHS: ['/hr'] },
  '@/utils/hrReturnTo': { hrDepartmentContext: () => ({}) },
  '@/utils/recordListOrigin': { owningListBack: () => '/hr', recordParentTo: () => '/hr' },
  '@/utils/formFeedback': { saveErrorMessage: () => 'error' },
  '@/composables/useHrPayrollCompensation': { useHrCompensation: query },
  '@/composables/useHrDepartments': { useHrDepartment: query, useHrDepartments: query },
  '@/composables/useHrEmployees': { useHrEmployee: query, useHrEmployees: query },
  '@/composables/useHrOnboarding': { useHrOnboardingPlans: query, useLaunchHrOnboardingRun: mutation },
  '@/composables/useHrShifts': { useHrShiftSchedules: query, useHrShiftAssignment: query, useHrShiftPeriod: () => () => '' },
  '@/composables/useHrLeave': { useHrLeaveAllocations: query, useHrLeaveAllocation: query },
  '@/composables/useHrLeaveFormat': { useHrLeaveFormat: () => ({ validity: () => '', days: () => '' }) },
  '@/utils/hrLeaveBadge': { hrLeaveBadge: () => ({ tone: 'neutral', labelKey: 'x' }) },
  '@webvue/ui/app/utils/safeReturnTo': { returnToQuery: () => ({}) },
}

/** The Nuxt auto-imports these pages call. */
function autoImports(can: (capability: string) => boolean, file: string): Record<string, unknown> {
  return {
    ref: Vue.ref, computed: Vue.computed, nextTick: Vue.nextTick,
    useI18n: () => ({ t: fakeT() }),
    useAccess: () => ({ can }),
    useHydrated: () => Vue.ref(true),
    useRoute: () => ({ params: { employeeId: '7', departmentId: '3' }, query: {}, hash: '', path: `/hr/${file}` }),
    useRouter: () => ({ resolve: () => ({ fullPath: '/hr' }), replace: () => undefined }),
    useRecordListPaths: () => Vue.ref(['/hr']),
    navigateTo: () => undefined,
    definePageMeta: () => undefined,
    useMyHrProfile: query,
    useHrAssetCategories: query,
    useHrRecruitmentJobList: query,
    useHrDepartments: query,
    useCreateHrApplicant: mutation,
    useCreateHrAssetCategory: mutation,
    useCreateHrRecruitmentJob: mutation,
  }
}

function loadPage(file: string, can: (capability: string) => boolean): Vue.Component {
  const filename = resolve(import.meta.dirname, '..', file)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const code = ts.transpileModule(compileScript(descriptor, { id: 'page', inlineTemplate: true }).content, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const require = (specifier: string) => {
    if (specifier in MODULES) return MODULES[specifier]
    throw new Error(`${file} imports ${specifier}; declare it in MODULES`)
  }
  const globals = autoImports(can, file)
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', ...Object.keys(globals), code)(require, exports, ...Object.values(globals))
  return exports.default!
}

// The other tags these templates name, besides the real shared states under test.
const layout = Vue.defineComponent({ inheritAttrs: false, setup(_, { slots }) { return () => Vue.h('section', slots.default?.()) } })
const TAGS = Object.fromEntries([
  'SharedPageState', 'SharedPageHeader', 'SharedUnsavedChanges', 'SharedDateField', 'SharedFormActions', 'SharedFormSection',
  'UForm', 'UFormField', 'UInput', 'UInputNumber', 'USelect', 'UTextarea',
].map(name => [name, Stub(name)]))

async function render(file: string, can: (capability: string) => boolean) {
  const app = Vue.createSSRApp({ render: () => Vue.h(loadPage(file, can)) })
  app.config.globalProperties.$t = fakeT() as never
  const real = { SharedForbiddenState: loadShared('ForbiddenState'), SharedEmptyState: loadShared('EmptyState') }
  for (const [tag, stub] of Object.entries({ ...DEFAULT_STUBS, ...TAGS, SharedCreatePanel: layout, SharedPageContainer: layout, ...real })) app.component(tag, stub)
  return renderToString(app)
}

describe('HR pages gated on a capability show the forbidden state, not an empty state', () => {
  it.each(PAGES)('%s without %s renders role="alert"', async (file, capability, description) => {
    const html = await render(file, granted => granted !== capability)
    expect(html).toContain('role="alert"')
    expect(html).toContain('data-slot="forbidden-state"')
    expect(html).not.toContain('role="status"')
    if (description) expect(html).toContain(description)
  })

  it.each(PAGES)('%s with %s renders no forbidden state', async (file, capability) => {
    const html = await render(file, granted => granted === capability)
    expect(html).not.toContain('data-slot="forbidden-state"')
  })
})
