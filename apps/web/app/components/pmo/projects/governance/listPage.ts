import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'
import { governanceFilters, type GovernanceRegisterFilters } from '../../../../composables/projectGovernanceKeys'
import { useGovernancePaging } from './listPaging'

type GovernanceListData = { items: { id: number }[]; total: number; can_manage?: boolean }
type GovernanceListItem<TList extends { data: Ref<GovernanceListData | undefined> }> = NonNullable<TList['data']['value']>['items'][number]

/**
 * The page logic the governance lists (register, stakeholders) share: the list route and its project id, the `?q=` search
 * box and filter writes, paging, links out of the list that carry its live state, and the inline delete confirmation
 * that follows the live list. A page keeps only its own columns, filters and wording.
 */
export function useGovernanceListPage<TList extends { data: Ref<GovernanceListData | undefined>; isFetching: Ref<boolean> }>(options: {
  section: 'register' | 'stakeholders'
  useList: (projectId: ComputedRef<number | null>, parsed: ComputedRef<GovernanceRegisterFilters>) => TList
  remove: { mutateAsync: (variables: { projectId: number; id: number }) => Promise<unknown>; isPending: Ref<boolean> }
  deletedTitle: string
  deleteLabel: string
  confirmTestId: string
  deleteError: (cause: unknown) => string
  context: { route: RouteLocationNormalizedLoaded; router: Router; hydrated: Ref<boolean>; toast: { add: (toast: { title: string; color: 'success' }) => unknown } }
}) {
  const { route, router, hydrated, toast } = options.context
  const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
  const isListRoute = computed(() => {
    const rest = normalizedPath.value.replace(new RegExp(`^/projects/[^/]+/${options.section}`), '')
    return rest === '' || rest === '/new'
  })
  const id = computed(() => Number(route.params.id))
  const parsed = computed(() => governanceFilters(route.query))
  const list = options.useList(computed(() => isListRoute.value ? id.value : null), parsed)

  function setFilter(key: string, value: string) {
    void router.replace({ query: { ...route.query, [key]: value || undefined, offset: undefined } })
  }
  const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
  watch(search, value => setFilter('q', value), { flush: 'sync' })
  watch(() => route.query.q, (value) => { search.value = typeof value === 'string' ? value : '' })
  const paging = useGovernancePaging(list, computed(() => parsed.value.offset ?? 0), isListRoute, options.context)

  // A link out of the list carries the list's own state, with the search being typed; a referrer's returnTo is dropped.
  const liveQuery = computed(() => {
    const { returnTo: _referrer, ...rest } = route.query
    return { ...rest, q: search.value.trim() || undefined }
  })
  const itemTo = (item: { id: number }) => ({ path: `/projects/${id.value}/${options.section}/${item.id}`, query: liveQuery.value })
  const createTo = computed(() => list.data.value?.can_manage ? { path: `/projects/${id.value}/${options.section}/new`, query: liveQuery.value } : undefined)
  function openLiveItem(event: MouseEvent, item: { id: number }) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    void router.push(itemTo(item))
  }

  const confirmDeleteId = ref<number | null>(null)
  const error = ref<string | null>(null)
  const confirmItem = computed(() => (list.data.value?.items.find(item => item.id === confirmDeleteId.value) ?? null) as GovernanceListItem<TList> | null)
  async function deleteItem(item: { id: number }) {
    error.value = null
    if (confirmDeleteId.value !== item.id) { confirmDeleteId.value = item.id; return }
    try {
      await options.remove.mutateAsync({ projectId: id.value, id: item.id })
      confirmDeleteId.value = null
      toast.add({ title: options.deletedTitle, color: 'success' })
    }
    catch (cause) {
      error.value = options.deleteError(cause)
    }
  }
  // The row menu only opens the confirmation; deletion happens from SharedInlineConfirm.
  function rowActions(item: { id: number }): RowAction[] {
    return [{
      label: options.deleteLabel,
      icon: 'i-lucide-trash-2',
      destructive: true,
      disabled: options.remove.isPending.value,
      onSelect: () => {
        if (confirmDeleteId.value === item.id) return
        void deleteItem(item)
        void nextTick(() => document.querySelector(`[data-testid="${options.confirmTestId}"]`)?.scrollIntoView({ block: 'nearest' }))
      },
    }]
  }
  function cancelDelete() {
    confirmDeleteId.value = null
    error.value = null
  }

  return { isListRoute, id, parsed, list, search, setFilter, ...paging, itemTo, createTo, openLiveItem, confirmDeleteId, error, confirmItem, deleteItem, rowActions, cancelDelete }
}
