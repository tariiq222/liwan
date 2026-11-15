import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Mutation = { onSuccess: (detail: { id: number }) => unknown }
const options: Mutation[] = []
const setQueryData = vi.fn()
const invalidate = vi.fn()
vi.mock('@tanstack/vue-query', () => ({
  keepPreviousData: undefined,
  useQuery: () => ({}),
  useInfiniteQuery: () => ({}),
  useMutation: (config: Mutation) => { options.push(config); return config },
  useQueryClient: () => ({ setQueryData, invalidateQueries: invalidate }),
}))
vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
vi.stubGlobal('computed', Vue.computed)
vi.stubGlobal('toValue', Vue.toValue)

const { inboxKeys, useLinkInboxContactCustomer } = await import('../useInbox')

beforeEach(() => { options.length = 0; setQueryData.mockClear(); invalidate.mockClear() })

describe('useLinkInboxContactCustomer', () => {
  it('stores the linked contact and refreshes every inbox read that shows its customer', () => {
    useLinkInboxContactCustomer(9)
    const detail = { id: 9 }
    options[0]!.onSuccess(detail)
    expect(setQueryData).toHaveBeenCalledWith(inboxKeys.contact(9), detail)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: inboxKeys.all })
  })
})
