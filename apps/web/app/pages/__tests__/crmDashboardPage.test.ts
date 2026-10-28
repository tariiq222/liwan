import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import type { CrmDashboard } from '@webvue/contracts'
import { DEFAULT_STUBS, renderShared } from '@webvue/ui/test/helpers/renderShared'
import * as crmDashboard from '../../utils/crmDashboard'
import * as crmOpportunity from '../../utils/crmOpportunity'

const file = resolve(import.meta.dirname, '../crm/index.vue')
const marker = (testid: string) => Vue.defineComponent({ inheritAttrs: false, setup: () => () => Vue.h('div', { 'data-testid': testid }) })
const section = (tag: string) => Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h(tag, attrs, slots.default?.()) })
const PageState = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) })
const KpiStrip = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('div', attrs) })

const agent: CrmDashboard['agent'] = { due_now: 1, new_today: 0, won_this_month: { count: 0, value: 0 } }
const manager: NonNullable<CrmDashboard['manager']> = { unassigned: 1, needs_manager: 0, due_follow_ups: 0, won_this_month: { count: 0, value: 0 }, conversion_by_source: [], agents: [] }

function render(data: CrmDashboard) {
  const none = { data: Vue.ref(undefined), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => {} }
  return renderShared(file, {}, {}, {
    stubs: {
      ...DEFAULT_STUBS, SharedPageContainer: section('main'), SharedPageHeader: marker('header'), SharedPageState: PageState, SharedKpiStrip: KpiStrip, SharedForbiddenState: marker('forbidden'),
    },
    globals: {
      useAccess: () => ({ can: () => true }),
      useMe: () => ({ me: Vue.ref({ id: 2 }) }),
    },
    modules: {
      '@/components/crm/dashboard/CrmDashboardAgentTable.vue': { __esModule: true, default: marker('agent-table') },
      '@/components/crm/dashboard/CrmDashboardConversion.vue': { __esModule: true, default: marker('conversion') },
      '@/components/crm/dashboard/CrmDashboardDueList.vue': { __esModule: true, default: marker('due-list') },
      '@/composables/crm/useCrmDashboard': { useCrmDashboard: () => ({ ...none, data: Vue.ref(data) }) },
      '@/composables/crm/useOpportunities': { useCrmOpportunities: () => ({ ...none, data: Vue.ref({ items: [], total: 0 }) }) },
      '@/utils/crmDashboard': crmDashboard,
      '@/utils/crmOpportunity': crmOpportunity,
    },
  })
}

describe('the CRM dashboard page', () => {
  it('shows the agent block and no manager block when the server sends none', async () => {
    const html = await render({ agent, manager: null })
    expect(html).toContain('crm-agent-kpis')
    expect(html).toContain('due-list')
    for (const hidden of ['crm-manager-kpis', 'conversion', 'agent-table']) expect(html).not.toContain(hidden)
  })

  it('adds the manager block when the server sends one', async () => {
    const html = await render({ agent, manager })
    for (const shown of ['crm-agent-kpis', 'crm-manager-kpis', 'conversion', 'agent-table']) expect(html).toContain(shown)
  })
})
