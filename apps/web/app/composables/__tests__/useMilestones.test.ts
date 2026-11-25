import { beforeEach, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useMilestones } from '../useMilestones'

const state = vi.hoisted(() => ({ fetchNextPage: vi.fn(), api: vi.fn() }))
vi.mock('@tanstack/vue-query', () => ({
  useInfiniteQuery: () => ({
    data: ref(undefined),
    hasNextPage: computed(() => true),
    isFetchingNextPage: ref(false),
    isError: ref(false),
    isSuccess: ref(false),
    fetchNextPage: state.fetchNextPage,
  }),
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}))

beforeEach(() => {
  state.fetchNextPage.mockReset()
  vi.stubGlobal('useApi', () => ({ $api: state.api }))
})

// The page's strip and the table each read the same shared query, so both watchers can walk the pages at
// once; a plain fetchNextPage cancels the sibling's in-flight page and the walk never settles.
it('walks the pages without cancelling the sibling watcher fetch', () => {
  useMilestones(ref(7))
  expect(state.fetchNextPage).toHaveBeenCalledTimes(1)
  expect(state.fetchNextPage).toHaveBeenCalledWith({ cancelRefetch: false })
})
