import type { MaybeRefOrGetter } from 'vue'
import { inject, onScopeDispose, provide, readonly, ref, toValue, useId, watch, type InjectionKey, type Ref } from 'vue'

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

const PROJECT_FRAME_HEADING = Symbol('nasq-project-frame-heading') as InjectionKey<Readonly<Ref<boolean>>>
const NO_PROJECT_FRAME = readonly(ref(false))

/**
 * The project workspace frame renders the project name as the page's `<h1>`.
 * A page header nested inside it would be a second `<h1>` on the same page, so
 * the frame publishes whether its heading is actually on screen — it is absent
 * while the project is still loading, and on a record whose project failed to
 * load — and SharedPageHeader demotes itself to `<h2>` only for as long as it is.
 */
export function provideProjectFrameHeading(shown: Readonly<Ref<boolean>>) {
  provide(PROJECT_FRAME_HEADING, shown)
}

export function useProjectFrameHeading(): Readonly<Ref<boolean>> {
  return inject(PROJECT_FRAME_HEADING, NO_PROJECT_FRAME)
}
