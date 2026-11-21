import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../settings/apps/crm/index.vue')
const LISTS = ['CrmStageListCard', 'CrmOutcomeListCard', 'CrmNamedListCard']
const READ_ONLY = 'data-testid="crm-tenant-lists-readonly"'
const section = (tag: string) => Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h(tag, attrs, slots.default?.()) })
const PageState = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) })
const marker = (name: string) => Vue.defineComponent({
  inheritAttrs: false,
  props: { canEdit: Boolean },
  setup: (props) => () => Vue.h('div', { 'data-list': name, 'data-can-edit': String(props.canEdit) }),
})
const idle = marker('other')

function render(settings: { can_manage_tenant_lists: boolean }, can: (capability: string) => boolean = () => true) {
  const lists = Object.fromEntries(LISTS.map(name => [`@/components/crm/settings/${name}.vue`, { __esModule: true, default: marker(name) }]))
  const others = Object.fromEntries(['CrmCustomFieldsCard', 'CrmDistributionCard', 'CrmFollowupCard', 'CrmPackageListCard', 'CrmPresetCard', 'CrmPricingCard', 'CrmPrivacyCard', 'CrmTermsCard']
    .map(name => [`@/components/crm/settings/${name}.vue`, { __esModule: true, default: idle }]))
  return renderShared(file, {}, {}, {
    stubs: { ...DEFAULT_STUBS, SharedSettingsPage: section('main'), SharedPageHeader: section('header'), SharedPageState: PageState, SharedForbiddenState: section('div'), SharedRouteTabs: section('nav') },
    globals: {
      useAccess: () => ({ can }),
      useSettingsPage: () => ({ parts: Vue.ref([{ id: 'stages' }]), shows: () => true, tabItems: Vue.ref([]), activeTab: Vue.ref('workflow') }),
    },
    modules: {
      ...lists,
      ...others,
      '@/composables/crm/useCrmSettings': {
        useCrmSettings: () => ({ data: Vue.ref(settings), error: Vue.ref(null), isLoading: Vue.ref(false), refetch: async () => ({ data: settings }) }),
      },
    },
  })
}

describe('the CRM settings page', () => {
  it('shows the read-only notice and read-only lists when only the root company manager may change them', async () => {
    const html = await render({ can_manage_tenant_lists: false })
    expect(html).toContain(READ_ONLY)
    for (const name of LISTS) expect(html).toContain(`data-list="${name}" data-can-edit="false"`)
  })

  it('shows editable lists and no notice when the server allows the lists', async () => {
    const html = await render({ can_manage_tenant_lists: true })
    expect(html).not.toContain(READ_ONLY)
    for (const name of LISTS) expect(html).toContain(`data-list="${name}" data-can-edit="true"`)
  })

  it('shows no notice to a reader, who cannot change anything anyway', async () => {
    const html = await render({ can_manage_tenant_lists: false }, capability => capability === 'crm.settings.read')
    expect(html).not.toContain(READ_ONLY)
  })
})
