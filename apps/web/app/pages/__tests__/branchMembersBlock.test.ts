import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, loadShared } from '@liwan/ui/test/helpers/renderShared'
import { createHostNode, hostRenderer, type HostNode } from '@liwan/ui/test/helpers/hostRenderer'
import { MAX_SEAT_PRIORITY } from '@liwan/contracts'
import { accessErrorMessage } from '../../utils/accessErrors'

const mounted: Vue.App[] = []
afterEach(() => mounted.splice(0).forEach(app => app.unmount()))
const settle = async () => { await Vue.nextTick(); await Vue.nextTick() }
const textOf = (node: HostNode): string => (node.type === 'comment' ? '' : node.text ?? '') + node.children.map(textOf).join('')

const policy = { version: 'v1', mode: 'inherited', preset: 'custom', strict_scopes: [], roles: [{ id: 3 }], branches: [{ id: 2, name: 'Policy branch', inherit: true, role_ids: [3] }] }

function mountPage(options: { caps?: string[]; policyData?: unknown; policyError?: unknown; branches?: { id: number; name: string }[] | undefined; branchError?: unknown } = {}) {
  const caps = options.caps ?? ['access.users.grant', 'access.users.assign_roles', 'access.roles.read']
  const branchQuery = { data: Vue.ref(options.branches === undefined ? undefined : { items: options.branches, total: options.branches.length }), error: Vue.ref(options.branchError ?? null), isLoading: Vue.ref(false), refetch: vi.fn() }
  const branchesEnabled = vi.fn()
  const rolesEnabled = vi.fn()
  const roles = [{ id: 5, name: { ar: 'م', en: 'm' }, active: true, assignable: true, company_id: null }]
  const stub = Vue.defineComponent({ render: () => null })
  const cards: string[] = []
  const card = Vue.defineComponent({
    props: ['branch', 'roles'],
    setup(props) { cards.push(props.branch.name); return () => Vue.h('li', `card:${props.branch.name}:${props.roles.length}`) },
  })
  const box = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', Object.values(slots).flatMap(slot => slot?.() ?? [])) })
  const policyQuery = { data: Vue.ref(options.policyData), error: Vue.ref(options.policyError ?? null), isLoading: Vue.ref(false), refetch: vi.fn() }
  const component = loadShared(resolve(import.meta.dirname, '../settings/team/branches.vue'), {
    globals: {
      useMe: () => ({ me: Vue.ref({ id: 7, company: { id: 1 }, read_only: false }) }), useAccess: () => ({ can: (key: string) => caps.includes(key) }), useHydrated: () => Vue.ref(true),
    },
    modules: {
      '@/components/access/branches/BranchPolicyCard.vue': { __esModule: true, default: stub },
      '@/components/access/branches/BranchPresetCard.vue': { __esModule: true, default: stub },
      '@/components/access/branches/BranchMembersCard.vue': { __esModule: true, default: card },
      '@/composables/useApi': { ApiError: class extends Error {} },
      '@/composables/useCreateBranch': { useCreateBranch: () => ({ isPending: { value: false }, mutateAsync: async () => ({}) }) },
      '@/composables/useAdminRoles': { useAdminRoles: (_params: unknown, enabled: Vue.Ref<boolean>) => { rolesEnabled(enabled); return { data: Vue.ref({ items: roles, total: 1 }) } } },
      '@/composables/useMemberships': { useMembershipBranches: (enabled: Vue.Ref<boolean>) => { branchesEnabled(enabled); return branchQuery } },
      '@/composables/useBranchAccess': {
        useBranchPolicy: () => policyQuery,
        useBranchSeats: () => ({ data: Vue.ref(null), error: Vue.ref(null), isLoading: Vue.ref(false), refetch: vi.fn() }),
        useSetBranchSeat: () => ({ isPending: Vue.ref(false), mutateAsync: vi.fn() }),
      },
      '@liwan/contracts': { MAX_SEAT_PRIORITY },
      '@/utils/accessErrors': { accessErrorMessage },
    },
  })
  const root = createHostNode()
  const app = hostRenderer.createApp(component)
  for (const [name, value] of Object.entries({ ...DEFAULT_STUBS, SharedSettingsPage: box, SharedPageHeader: box, SharedPageState: box, SharedRecordSection: box, UButton: box })) app.component(name, value)
  app.mount(root); mounted.push(app)
  return { root, cards, branchQuery, branchesEnabled, rolesEnabled }
}

describe('the branch members section', () => {
  it('has a card for every branch below the root, also one the policy does not list', async () => {
    const view = mountPage({ policyData: policy, branches: [{ id: 2, name: 'Policy branch' }, { id: 9, name: 'Brand new branch' }] })
    await settle()
    const text = textOf(view.root)
    expect(text).toContain('card:Policy branch:1')
    expect(text).toContain('card:Brand new branch:1')
  })
  it('does not wait for the branch policy: it is drawn while the policy has failed or is missing', async () => {
    const view = mountPage({ policyData: undefined, policyError: new Error('policy failed'), branches: [{ id: 9, name: 'Brand new branch' }] })
    await settle()
    expect(textOf(view.root)).toContain('card:Brand new branch')
  })
  it('is not drawn without the grant, and its queries are not enabled', async () => {
    const view = mountPage({ caps: ['access.users.assign_roles', 'access.roles.read'], policyData: policy, branches: [{ id: 9, name: 'Brand new branch' }] })
    await settle()
    expect(textOf(view.root)).not.toContain('card:')
    expect(Vue.unref(view.branchesEnabled.mock.calls[0]![0])).toBe(false)
    expect(Vue.unref(view.rolesEnabled.mock.calls[0]![0])).toBe(false)
  })
  it('is not drawn in a branch, where the list is empty', async () => {
    const view = mountPage({ policyData: policy, branches: [] })
    await settle()
    expect(textOf(view.root)).not.toContain('card:')
  })
  it('asks for the roles only with the grant and the right to read roles', async () => {
    const view = mountPage({ caps: ['access.users.grant'], branches: [{ id: 9, name: 'Brand new branch' }] })
    await settle()
    expect(Vue.unref(view.branchesEnabled.mock.calls[0]![0])).toBe(true)
    expect(Vue.unref(view.rolesEnabled.mock.calls[0]![0])).toBe(false)
  })
})

describe('the cards of the section', () => {
  const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../../..', path), 'utf8')
  it('apply the one role rule for their branch and name it in the list and the add form', () => {
    const card = read('app/components/access/branches/BranchMembersCard.vue')
    expect(card).toContain('offerableRoles(props.roles, props.branch.id)')
    expect(card.match(/:company-id="props\.branch\.id"/g)?.length).toBe(2)
  })
  it('keep the member list out of the way of someone who may not grant', () => {
    expect(read('app/components/access/users/CompanyMembers.vue')).toContain('v-if="canGrant"')
    expect(read('app/pages/settings/team/users/index.vue')).toContain("v-if=\"!forbidden && can('access.users.grant')\" id=\"members\"")
  })
})
