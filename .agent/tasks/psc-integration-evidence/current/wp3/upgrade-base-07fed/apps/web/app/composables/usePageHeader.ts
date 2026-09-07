import type { MaybeRefOrGetter } from 'vue'
import { computed, onScopeDispose, toValue, useId, watch } from 'vue'

interface PageHeaderRegistration {
  owner: string
  route: string
  title: string
  description?: string
}

const PAGE_HEADER_STATE_KEY = 'nasq-page-header'

function usePageHeaderState() {
  return useState<PageHeaderRegistration | null>(PAGE_HEADER_STATE_KEY, () => null)
}

export function usePageHeader(
  title: MaybeRefOrGetter<string>,
  description?: MaybeRefOrGetter<string | undefined>,
) {
  const route = useRoute()
  const state = usePageHeaderState()
  const owner = useId()

  watch(() => ({
    route: route.path,
    title: toValue(title),
    description: description ? toValue(description) : undefined,
  }), (next, previous) => {
    // During navigation Vue may update the shared route before disposing the
    // outgoing page. Keep its title bound to the old route instead of letting
    // it flash over the incoming route while both component scopes overlap.
    if (previous && next.route !== previous.route && next.title === previous.title) {
      if (state.value?.owner === owner) state.value = null
      return
    }

    state.value = {
      owner,
      ...next,
    }
  }, { immediate: true, flush: 'sync' })

  onScopeDispose(() => {
    if (state.value?.owner === owner) state.value = null
  })
}

export function useShellPageHeader() {
  const route = useRoute()
  const state = usePageHeaderState()

  const title = computed(() => state.value?.route === route.path ? state.value.title : undefined)
  const description = computed(() => state.value?.route === route.path ? state.value.description : undefined)

  return { title, description }
}
