import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import type { CrmDashboard } from '@liwan/contracts'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as crmDashboard from '../../utils/crmDashboard'
import * as crmCallResult from '../../utils/crmCallResult'
import * as crmErrors from '../../utils/crmErrors'
import * as crmOpportunity from '../../utils/crmOpportunity'

const file = resolve(import.meta.dirname, '../crm/index.vue')
const marker = (testid: string) => Vue.defineComponent({ inheritAttrs: false, setup: () => () => Vue.h('div', { 'data-testid': testid }) })
const section = (tag: string) => Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h(tag, attrs, slots.default?.()) })
const Header = Vue.defineComponent({ inheritAttrs: false, setup: (_, { slots }) => () => Vue.h('header', { 'data-testid': 'header' }, slots.actions?.()) })
const PageState = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) })
const KpiStrip = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('div', attrs) })

const agent: CrmDashboard['agent'] = { due_now: 1, new_today: 0, won_this_month: { count: 0, value: 0 } }
const manager: NonNullable<CrmDashboard['manager']> = { unassigned: 1, needs_manager: 0, due_follow_ups: 0, won_this_month: { count: 0, value: 0 }, conversion_by_source: [], agents: [] }

function render(data: CrmDashboard, can: (capability: string) => boolean = () => true, { due = {}, opportunities = 0 }: { due?: Record<string, unknown>, opportunities?: number } = {}) {
  const none = { data: Vue.ref(undefined), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => {} }
  return renderShared(file, {}, {}, {
    stubs: {
      ...DEFAULT_STUBS, SharedPageContainer: section('main'), SharedPageHeader: Header, SharedUnsavedChanges: marker('unsaved'), SharedPageState: PageState, SharedKpiStrip: KpiStrip, SharedForbiddenState: marker('forbidden'), UAlert: section('div'),
    },
    globals: {
      useAccess: () => ({ can }),
      useToast: () => ({ add: () => {} }),
      useMe: () => ({ me: Vue.ref({ id: 2 }) }),
    },
    modules: {
      '@/components/crm/dashboard/CrmDashboardAgentTable.vue': { __esModule: true, default: marker('agent-table') },
      '@/components/crm/dashboard/CrmDashboardConversion.vue': { __esModule: true, default: marker('conversion') },
      '@/components/crm/dashboard/CrmDashboardDueList.vue': { __esModule: true, default: marker('due-list') },
      '@/composables/crm/useCrmDashboard': { useCrmDashboard: () => ({ ...none, data: Vue.ref(data) }) },
      '@/composables/crm/useCrmLists': { useCrmOutcomeChoices: () => ({ data: Vue.ref({ items: [] }) }), useCrmPackageChoices: () => ({ data: Vue.ref({ items: [] }) }), useCrmLostReasonChoices: () => ({ data: Vue.ref({ items: [] }) }) },
      '@/composables/crm/useCrmTerms': { useCrmTerms: () => ({ term: (_key: string, form: string) => (form === 'one' ? 'فرصة' : 'فرص') }) },
      '@/composables/crm/useOpportunities': {
        useCrmOpportunities: (params: unknown) => (typeof params === 'function' && (params() as { due?: boolean }).due
          ? { ...none, isPending: Vue.ref(false), data: Vue.ref({ items: [], total: 0 }), ...due }
          : { ...none, data: Vue.ref({ items: [], total: opportunities }) }),
        useCrmOpportunityActions: () => ({ recordCall: { isPending: Vue.ref(false), mutateAsync: async () => ({}) } }),
      },
      '@/utils/crmCallResult': crmCallResult,
      '@/utils/crmErrors': crmErrors,
      '@/utils/crmDashboard': crmDashboard,
      '@/utils/crmOpportunity': crmOpportunity,
    },
  })
}

describe('the CRM dashboard page', () => {
  it('guides eligible CRM users to create the first opportunity', async () => {
    const data = { agent, manager: null }
    const alert = 'data-testid="crm-first-opportunity"'
    expect(await render(data)).toContain(alert)
    expect(await render(data, () => true, { opportunities: 1 })).not.toContain(alert)
    expect(await render(data, capability => capability === 'crm.leads.read')).not.toContain(alert)
    expect(await render(data, capability => capability === 'crm.leads.assign' || capability === 'crm.leads.read')).toContain(alert)
  })

  it('shows the agent block and no manager block when the server sends none', async () => {
    const html = await render({ agent, manager: null })
    expect(html).toContain('crm-agent-kpis')
    expect(html).toContain('due-list')
    for (const hidden of ['crm-manager-kpis', 'conversion', 'agent-table']) expect(html).not.toContain(hidden)
  })

  it('offers one create button to those who work or assign leads', async () => {
    const html = await render({ agent, manager: null }, capability => capability === 'crm.leads.read' || capability === 'crm.leads.work')
    expect(html).toContain('data-shortcut-create')
    expect(html).toContain('crm.opportunities.list.new')
    expect(await render({ agent, manager: null }, capability => capability === 'crm.leads.assign' || capability === 'crm.leads.read')).toContain('data-shortcut-create')
    expect(await render({ agent, manager: null }, capability => capability === 'crm.leads.read')).not.toContain('data-shortcut-create')
  })

  it('adds the manager block when the server sends one', async () => {
    const html = await render({ agent, manager })
    for (const shown of ['crm-agent-kpis', 'crm-manager-kpis', 'conversion', 'agent-table']) expect(html).toContain(shown)
  })
})
