import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../composables/useApi'
import { useCustomerConflict } from '../../composables/customers/useCustomerConflict'

const file = resolve(import.meta.dirname, '../crm/opportunities/[id].vue')

// The page script runs against stubbed composables; any name it does not use here resolves to a no-op.
function mountPage(sell: () => Promise<unknown>) {
  const descriptor = parse(readFileSync(file, 'utf8'), { filename: file }).descriptor
  const script = compileScript(descriptor, { id: 'crm-opportunity-page' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const toast = vi.fn()
  const pending = { isPending: Vue.ref(false), mutateAsync: vi.fn() }
  const known: Record<string, unknown> = {
    ...Vue, _defineComponent: Vue.defineComponent, _unref: Vue.unref,
    useRoute: () => ({ params: { id: '7' }, query: {}, hash: '', path: '/crm/opportunities/7' }), useRouter: () => ({ resolve: () => ({ fullPath: '/crm' }) }),
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('ar') }), useAccess: () => ({ can: () => true }), useMe: () => ({ me: Vue.ref({ id: 1 }) }),
    useToast: () => ({ add: toast }), useHydrated: () => Vue.ref(true), useCustomerConflict,
    useCrmOpportunity: () => ({ data: Vue.ref({ id: 7, status: 'open', stage: { id: 1 } }), error: Vue.ref(null), isPending: Vue.ref(false), isSuccess: Vue.ref(true), refetch: vi.fn() }),
    useCrmOpportunityActions: () => ({ sell: { ...pending, mutateAsync: sell }, patch: pending, lose: pending, recordCall: pending, linkCustomer: pending, reopen: pending, assign: pending }),
    useCrmTerms: () => ({ term: () => '' }), useRecordListPaths: () => Vue.ref([]), owningListBack: () => ({}),
    ApiError, CRM_LIST_PATH: '/crm', movableStages: () => [], manualLostReasons: () => [], canWorkOpportunity: () => true,
    opportunityOrderGate: () => ({ blocked: null, winByOrder: false }), callOutcomesFor: () => [], isCallDue: () => false,
    crmErrorMessage: () => 'error', statusTag: () => ({}),
  }
  const unknownName = (name: string) => {
    if (name in globalThis) return (globalThis as Record<string, unknown>)[name]
    return name.startsWith('use') ? () => ({ data: Vue.ref(null), error: Vue.ref(null), isPending: Vue.ref(false), read: Vue.ref(false), write: Vue.ref(false) }) : vi.fn()
  }
  const scope = new Proxy(known, {
    has: () => true,
    get: (target, name) => (typeof name !== 'string' ? undefined : name in target ? target[name] : unknownName(name)),
  })
  const component = new Function('scope', `with (scope) { ${code} }`)(scope)
  const state = Vue.proxyRefs(component.setup({}, { expose: () => {}, emit: () => {} }))
  return { state, toast }
}

describe('the opportunity page after a customer conflict', () => {
  it('runs the success steps once the retried attempt succeeds, not only on the first success', async () => {
    const conflict = new ApiError(409, 'conflict', 'x', undefined, { candidates: [{ id: 4, name: 'Sara', phone_last4: '4567' }] })
    const sell = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValue({ id: 7 })
    const { state, toast } = mountPage(sell)
    state.saleDraft = { package_id: 3, final_price: 100 }
    state.panel = 'sale'
    await state.sell()
    expect(toast).not.toHaveBeenCalled()
    expect(state.stepOpen).toBeTruthy()
    await state.conflict.choose({ customer_id: 4 })
    expect(sell).toHaveBeenCalledTimes(2)
    expect(toast).toHaveBeenCalledWith({ title: 'crm.opportunities.sale.sold', color: 'success' })
    expect(state.panel).toBeNull()
  })
})
