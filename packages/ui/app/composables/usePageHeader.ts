import type { MaybeRefOrGetter } from 'vue'
import { computed, inject, onScopeDispose, provide, readonly, ref, toValue, useId, watch, type InjectionKey, type Ref } from 'vue'

interface PageHeaderRegistration {
  owner: string
  route: string
  title: string
}

const PAGE_HEADER_STATE_KEY = 'liwan-page-header'

function usePageHeaderState() {
  return useState<PageHeaderRegistration | null>(PAGE_HEADER_STATE_KEY, () => null)
}

export function usePageHeader(title: MaybeRefOrGetter<string>) {
  const route = useRoute()
  const state = usePageHeaderState()
  const owner = useId()

  watch(() => ({
    route: route.path,
    title: toValue(title),
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

const FRAME_OWNS_HEADING = Symbol('liwan-frame-owns-heading') as InjectionKey<Readonly<Ref<boolean>>>
const NO_FRAME_HEADING = readonly(ref(false))

/**
 * A page frame (for example the project workspace) can render the record name as the page's `<h1>`.
 * A page header nested inside it would be a second `<h1>` on the same page, so
 * the frame publishes whether its heading is actually on screen — it is absent
 * while its record is still loading, and on a record that failed to
 * load — and SharedPageHeader demotes itself to `<h2>` only for as long as it is.
 */
export function provideFrameOwnsHeading(shown: Readonly<Ref<boolean>>) {
  provide(FRAME_OWNS_HEADING, shown)
}

export function useFrameOwnsHeading(): Readonly<Ref<boolean>> {
  return inject(FRAME_OWNS_HEADING, NO_FRAME_HEADING)
}

const FRAME_OWNS_ACTIONS = Symbol('liwan-frame-owns-actions') as InjectionKey<Readonly<Ref<boolean>>>
const NO_FRAME_ACTIONS = readonly(ref(false))

/**
 * A page frame can draw the primary action (and the KPI toggle) of the page inside it in its own header row.
 * A list page with `hideHeader` then draws neither, so the page has one action row, not two. The frame says so
 * from the route alone, not from its loaded record, so the list never shows its own button for a moment first.
 */
export function provideFrameOwnsActions(owned: Readonly<Ref<boolean>>) {
  provide(FRAME_OWNS_ACTIONS, owned)
}

export function useFrameOwnsActions(): Readonly<Ref<boolean>> {
  return inject(FRAME_OWNS_ACTIONS, NO_FRAME_ACTIONS)
}

/** The title the current route's page header registered, for the shell breadcrumb; null until one registers. */
export function usePageHeaderTitle() {
  const route = useRoute()
  const state = usePageHeaderState()
  return computed(() => (state.value && state.value.route === route.path ? state.value.title : null))
}
