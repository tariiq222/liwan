import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import * as crmOpportunity from '../../utils/crmOpportunity'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../crm/opportunities/new.vue')
const marker = (testid: string) => Vue.defineComponent({ inheritAttrs: false, setup: () => () => Vue.h('div', { 'data-testid': testid }) })
const slotted = Vue.defineComponent({ inheritAttrs: false, setup: (_, { slots }) => () => Vue.h('section', slots.default?.()) })

function render(access: { canCreate: boolean, manualOnly?: boolean, pending?: boolean }) {
  return renderShared(file, {}, {}, {
    messages: { 'crm.opportunities.createManualOnly': 'الإسناد فقط' },
    stubs: { SharedListPage: slotted, SharedCreatePanel: slotted, SharedForbiddenState: Vue.defineComponent({ props: ['description'], setup: props => () => Vue.h('div', { 'data-testid': 'forbidden' }, props.description) }) },
    globals: {
      useAccess: () => ({ can: () => true }),
      useRoute: () => ({ query: {} }),
    },
    modules: {
      '@/components/crm/opportunity/CrmOpportunityForm.vue': { __esModule: true, default: marker('form') },
      '@/components/crm/opportunity/CrmOpportunityList.vue': { __esModule: true, default: marker('list') },
      '@/composables/crm/useCrmLists': { useCrmSourceChoices: () => ({ data: Vue.ref({ items: [] }) }) },
      '@/composables/crm/useCrmTerms': { useCrmTerms: () => ({ term: () => 'فرصة' }) },
      '@/composables/crm/useCrmAccess': { useCrmCreateAccess: () => ({ canCreate: Vue.ref(access.canCreate), manualOnly: Vue.ref(!!access.manualOnly), pending: Vue.ref(!!access.pending) }) },
      '@/utils/crmOpportunity': crmOpportunity,
      '@/composables/crm/useOpportunities': { useCreateCrmOpportunity: () => ({ mutateAsync: async () => ({}) }) },
    },
  })
}

describe('the new opportunity page', () => {
  it('shows the form when the server says the user may create', async () => {
    const html = await render({ canCreate: true })
    expect(html).toContain('data-testid="form"')
    expect(html).not.toContain('forbidden')
  })

  it('names manual distribution on a direct link only when the server refused a user who can work', async () => {
    const html = await render({ canCreate: false, manualOnly: true })
    expect(html).not.toContain('data-testid="form"')
    expect(html).toContain('data-testid="crm-create-forbidden"')
    expect(html).toContain('الإسناد فقط')
  })

  it('shows the generic forbidden state without the manual text when the user cannot work or the access request failed', async () => {
    const html = await render({ canCreate: false, manualOnly: false })
    expect(html).toContain('data-testid="crm-create-forbidden"')
    expect(html).not.toContain('الإسناد فقط')
  })

  it('shows neither while the answer loads', async () => {
    const html = await render({ canCreate: false, pending: true })
    expect(html).not.toContain('data-testid="form"')
    expect(html).not.toContain('crm-create-forbidden')
  })
})
