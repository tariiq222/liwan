import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, toValue } from 'vue'
import { withManifests } from '../../modules/manifests'
import type { AppManifest, AppSearchPage } from '../../modules/types'

// Fake vue-query: keeps the options so the test can drive `enabled`, `getNextPageParam` and the data.
const fake = vi.hoisted(() => ({ queries: [] as Array<{ options: Record<string, any>; pages: { value: AppSearchPage[] } }> }))
vi.mock('@tanstack/vue-query', async () => {
  const vue = await vi.importActual<typeof import('vue')>('vue')
  return {
    useInfiniteQuery: (options: Record<string, any>) => {
      const pages = vue.ref<AppSearchPage[]>([])
      fake.queries.push({ options, pages })
      return {
        data: vue.computed(() => ({ pages: pages.value })),
        isLoading: vue.ref(false),
        error: vue.ref(null),
        hasNextPage: vue.computed(() => {
          const last = pages.value.at(-1)
          return !!last && options.getNextPageParam(last, pages.value) !== undefined
        }),
        isFetchingNextPage: vue.ref(false),
        refetch: vi.fn(),
        fetchNextPage: vi.fn(),
      }
    },
  }
})

const provider = (serverSearch: boolean) => ({
  id: 'sales-orders', labelKey: 'nav.sales', capability: 'sales.orders.read', icon: 'i-lucide-receipt',
  serverSearch,
  queryKey: (q: string) => ['search', 'orders', q],
  search: async (): Promise<AppSearchPage> => ({ rows: [] }),
})
const sales = (serverSearch: boolean): AppManifest => ({
  id: 'sales', feature: 'sales.enabled', routePrefixes: ['/sales'],
  rail: [{ id: 'sales', labelKey: 'nav.sales', icon: 'i-lucide-receipt', to: '/sales', order: 90 }],
  nav: [], search: [provider(serverSearch)],
})
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, label: `Order ${i}`, to: `/sales/${i}` }))

async function setup(serverSearch: boolean, can: (capability: string) => boolean = () => true) {
  const { useAppSearch } = await import('../useAppSearch')
  const term = ref('')
  const debounced = ref('')
  const gate = ref(true)
  const sections = withManifests([sales(serverSearch)], () =>
    useAppSearch({ term, debounced, gate, requireTerm: true, can, api: vi.fn() as never }))
  return { sections, term, debounced, gate, query: fake.queries[0]! }
}

describe('useAppSearch', () => {
  beforeEach(() => { fake.queries.length = 0 })

  it('shows server rows only once the typed term equals the debounced term', async () => {
    const { sections, term, debounced, query } = await setup(true)
    query.pages.value = [{ rows: rows(2) }]
    term.value = 'ord'
    expect(sections[0]!.rows.value).toEqual([])
    debounced.value = 'ord'
    expect(sections[0]!.rows.value).toHaveLength(2)
  })

  it('filters unfiltered providers by label on the client', async () => {
    const { sections, term, query } = await setup(false)
    query.pages.value = [{ rows: rows(12) }]
    term.value = 'order 1'
    expect(sections[0]!.rows.value.map(row => row.id)).toEqual([1, 10, 11])
  })

  it('has a next page only while loaded rows are below the server total', async () => {
    const { sections, query } = await setup(true)
    query.pages.value = [{ rows: rows(2), total: 5 }]
    expect(sections[0]!.hasNext.value).toBe(true)
    query.pages.value = [{ rows: rows(2), total: 2 }]
    expect(sections[0]!.hasNext.value).toBe(false)
    query.pages.value = [{ rows: rows(2) }]
    expect(sections[0]!.hasNext.value).toBe(false)
  })

  it('enables nothing when the capability is missing, the gate is closed or no term is typed', async () => {
    const denied = await setup(true, () => false)
    denied.debounced.value = 'x'
    expect(toValue(denied.query.options.enabled)).toBe(false)
    expect(denied.sections[0]!.visible.value).toBe(false)
    fake.queries.length = 0
    const allowed = await setup(true)
    expect(toValue(allowed.query.options.enabled)).toBe(false)
    allowed.debounced.value = 'x'
    expect(toValue(allowed.query.options.enabled)).toBe(true)
    allowed.gate.value = false
    expect(toValue(allowed.query.options.enabled)).toBe(false)
  })
  it('passes the vue-query abort signal to every provider request', async () => {
    const { useAppSearch } = await import('../useAppSearch')
    const api = vi.fn(async () => [])
    const calling: AppManifest = {
      ...sales(true),
      search: [{
        ...provider(true),
        search: async (fetcher, q) => {
          await fetcher('/api/v1/sales', { query: { q }, schema: { parse: (value: unknown) => value } as never })
          return { rows: [] }
        },
      }],
    }
    withManifests([calling], () => useAppSearch({
      term: ref('a'), debounced: ref('a'), gate: true, requireTerm: true, can: () => true, api: api as never,
    }))
    const controller = new AbortController()
    await fake.queries[0]!.options.queryFn({ pageParam: 0, signal: controller.signal })
    expect(api).toHaveBeenCalledWith('/api/v1/sales', expect.objectContaining({ query: { q: 'a' }, signal: controller.signal }))
  })
})
