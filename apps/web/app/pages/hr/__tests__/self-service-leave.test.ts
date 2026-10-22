import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'

function load(path: string, personal: boolean, capabilities = ['hr.leave.read', 'hr.leave.approve'], profileData: unknown = {id:1}) {
  const root = resolve(import.meta.dirname, '../../..')
  const componentPath = resolve(root, 'components/hr/LeaveList.vue')
  const filename = componentPath
  const source = readFileSync(filename, 'utf8')
  const descriptor = parse(source, { filename }).descriptor
  const code = compileScript(descriptor, { id: 'leave-scope' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const route = { path: path.split('?')[0], fullPath: path, query: Object.fromEntries(new URLSearchParams(path.split('?')[1])), hash: '' }
  const response = () => ({ data: Vue.ref({items: [], total: 0}), error: Vue.ref(null), isLoading: Vue.ref(false), isFetching: Vue.ref(false), refetch: vi.fn() })
  let requested: any; let balancesEnabled: any
  const bindings = {
    RecordNumber: {}, hrLeaveBadge: () => ({}), recordNumberHeader: () => ({}), _defineComponent: Vue.defineComponent, computed: Vue.computed, ref: Vue.ref, h: Vue.h,
    useRoute: () => route, useRouter: () => ({ replace: vi.fn() }),
    useI18n: () => ({ t: (key: string) => key, n: String }), useHrLeaveFormat: () => ({ period: String, days: String }),
    useHydrated: () => Vue.ref(true), useKpiVisibility: () => ({shown: Vue.ref(true)}),
    useAccess: () => ({can: (capability: string) => capabilities.includes(capability)}),
    useHrLeaveRequests: (params: any) => { requested = params; return response() },
    useHrLeaveBalances: (_id: any, enabled: any) => { balancesEnabled = enabled; return response() },
    useMyHrProfile: () => ({ ...response(), data: Vue.ref(profileData) }),
    useLeaveDecision: () => ({isPending: Vue.ref(false)}), useWithdrawLeaveRequest: () => ({isPending: Vue.ref(false)}),
    returnToQuery: (value: string) => ({returnTo: value}),
  }
  const js = ts.transpileModule(code, { compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None} }).outputText
  const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
  const state = component.setup({personal}, {expose: () => {}})
  return {state, params: Vue.toValue(requested), balances: Vue.toValue(balancesEnabled)}
}

describe('employee leave ownership', () => {
  it('ignores all/pending query scopes in Self-service even for an HR approver', () => {
    for (const scope of ['all','pending']) {
      const loaded = load(`/account/leave?scope=${scope}&employee_id=92`, true)
      expect(loaded.params.scope).toBe('mine')
      expect(loaded.params).not.toHaveProperty('employee_id')
      expect(loaded.state.scopeItems.value).toEqual([])
    }
  })
  it.each(['hr.leave.manage','hr.leave.approve'])('opens the management queue for %s without fetching personal balances', capability => {
    const loaded = load('/hr/leave?scope=mine', false, ['hr.leave.read',capability])
    expect(loaded.params.scope).toBe('pending')
    expect(loaded.balances).toBe(false)
    expect(loaded.state.scopeItems.value.map((item: any) => item.value)).toEqual(['pending','all'])
  })
  it('does not offer a leave create action without an employee link', () => {
    const loaded = load('/account/leave', true, ['hr.leave.read','hr.leave.request'], null)
    expect(loaded.state.createTo.value).toBeUndefined()
    expect(loaded.balances).toBe(false)
  })
  it('keeps only own withdrawal actions in Self-service, even when backend HR action flags are true', () => {
    const loaded = load('/account/leave', true)
    const actions = loaded.state.rowActions({id:7,can_approve:true,can_refuse:true,can_cancel:true,can_withdraw:true})
    expect(actions.map((action:any) => action.label)).toEqual(['hr.leave.withdraw'])
  })
  it('links personal and management rows to their corresponding own/detail destinations', () => {
    expect(load('/account/leave?offset=25', true).state.leaveTo({id:7}).path).toBe('/account/leave/7')
    expect(load('/hr/leave?scope=all', false).state.leaveTo({id:7}).path).toBe('/hr/leave/7')
  })
})
