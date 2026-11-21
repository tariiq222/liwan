import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vue-query is replaced by a recorder of the mutation options and a small cache; the assertions are on which keys each
// mutation writes or invalidates.
type Mutation = { onSuccess: (result: unknown, variables: unknown) => unknown }
const options: Mutation[] = []
const cache = new Map<string, unknown>()
const invalidate = vi.fn()
const keyId = (key: readonly unknown[]) => JSON.stringify(key)
vi.mock('@tanstack/vue-query', () => ({
  keepPreviousData: undefined,
  useQuery: () => ({}),
  useMutation: (config: Mutation) => { options.push(config); return config },
  useQueryClient: () => ({
    getQueryData: (key: readonly unknown[]) => cache.get(keyId(key)),
    setQueryData: (key: readonly unknown[], value: unknown) => cache.set(keyId(key), value),
    invalidateQueries: invalidate,
  }),
}))
vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
vi.stubGlobal('useAccess', () => ({ can: () => true }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const { inboxKeys } = await import('../inbox/useInbox')
const { useLinkConversationOpportunity, useUnlinkConversationOpportunity } = await import('../useInboxOpportunity')
const { crmKeys } = await import('../crm/crmKeys')
const invalidated = () => invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey)

beforeEach(() => {
  options.length = 0
  cache.clear()
  invalidate.mockClear()
})

describe('conversation opportunity link', () => {
  it('refreshes the conversations of the new and of the previously linked opportunity', () => {
    cache.set(keyId(inboxKeys.opportunity(3)), { opportunity: { id: 11 }, hidden: false })
    useLinkConversationOpportunity(3)
    options[0]!.onSuccess({ id: 12 }, 12)
    expect(cache.get(keyId(inboxKeys.opportunity(3)))).toEqual({ opportunity: { id: 12 }, hidden: false })
    expect(invalidated()).toEqual([crmKeys.conversations(12), crmKeys.conversations(11)])
  })

  it('refreshes one opportunity when the link did not move', () => {
    cache.set(keyId(inboxKeys.opportunity(3)), { opportunity: { id: 12 }, hidden: false })
    useLinkConversationOpportunity(3)
    options[0]!.onSuccess({ id: 12 }, 12)
    expect(invalidated()).toEqual([crmKeys.conversations(12)])
  })

  it('refreshes the conversations of the opportunity an unlink leaves', () => {
    cache.set(keyId(inboxKeys.opportunity(3)), { opportunity: { id: 11 }, hidden: false })
    useUnlinkConversationOpportunity(3)
    options[0]!.onSuccess(undefined, undefined)
    expect(cache.get(keyId(inboxKeys.opportunity(3)))).toEqual({ opportunity: null, hidden: false })
    expect(invalidated()).toEqual([crmKeys.conversations(11)])
  })

  it('invalidates nothing when an unlink finds no link', () => {
    useUnlinkConversationOpportunity(3)
    options[0]!.onSuccess(undefined, undefined)
    expect(invalidate).not.toHaveBeenCalled()
  })
})
