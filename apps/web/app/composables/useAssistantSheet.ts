import { computed, defineAsyncComponent, ref, type Component } from 'vue'
// Relative imports: this module is unit-tested directly, where the `@/` alias does not resolve for values.
import { canReach } from '../utils/accessPolicy'
import { normalizedPath } from '../utils/routePath'
import { assistantSurface, routeScopeOf } from '../modules/surfaces'
import type { AppAssistantSurface } from '../modules/types'
import { ASSISTANT_PANEL, useSlideOver } from './useSlideOver'

/** Whether `path` is the assistant's own full page (or beneath it), where the top-bar button steps aside. */
export function isSurfacePath(path: string, surfaceTo: string): boolean {
  const target = normalizedPath(surfaceTo)
  const current = normalizedPath(path)
  return current === target || current.startsWith(`${target}/`)
}

// The foundation's own rail modules say nothing the assistant could use as a page.
const NO_CONTEXT_MODULES: readonly string[] = ['home', 'settings']

/**
 * The `?context=` value the full page reads (`page` or `page:id`): the record the current path lives inside, else the
 * rail module; null where there is nothing to say (home, settings, or a module id the page would not accept).
 */
export function assistantContext(path: string, moduleId: string | null): string | null {
  const scope = routeScopeOf(path)
  if (scope) return `${scope.kind}:${scope.id}`
  return moduleId && !NO_CONTEXT_MODULES.includes(moduleId) && /^[a-z]+$/.test(moduleId) ? moduleId : null
}

const bodyLoaded = ref(false)

// One async wrapper per declared surface, so reopening the panel never reloads the body.
const bodyViews = new WeakMap<AppAssistantSurface, Component>()
/** The surface's body, loaded on first use (the shell imports no application code, R3). */
export function assistantBodyView(surface: AppAssistantSurface): Component {
  let view = bodyViews.get(surface)
  if (!view) {
    view = defineAsyncComponent(() => surface.load().then((module) => { bodyLoaded.value = true; return module }))
    bodyViews.set(surface, view)
  }
  return view
}

/**
 * The assistant's top-bar state: whether this identity and page may show it, and whether its slide-over is open
 * (the panel itself is one of the slide-over host's panels, so opening and closing go through `useSlideOver`).
 */
export function useAssistantSheet() {
  const route = useRoute()
  const { me } = useMe()
  const slideOver = useSlideOver()

  /** The declared surface, only when this user may use it (capability plus its application feature). */
  const surface = computed<AppAssistantSurface | undefined>(() => {
    const declared = assistantSurface()
    return declared && canReach(me.value, declared.capability, declared.to) ? declared : undefined
  })
  const onSurfacePage = computed(() => !!surface.value && isSurfacePath(route.path, surface.value.to))
  /** The top-bar button shows everywhere except the full page, where that page is the surface. */
  const showButton = computed(() => !!surface.value && !onSurfacePage.value)
  const shown = computed(() => slideOver.open.value === ASSISTANT_PANEL && showButton.value)

  /** The full page link: the current record or module rides along as `?context=`. */
  function fullPageTo(moduleId: string | null) {
    const context = assistantContext(route.path, moduleId)
    return { path: surface.value?.to ?? '/', ...(context ? { query: { context } } : {}) }
  }

  return {
    surface, showButton, shown, onSurfacePage, bodyLoaded, fullPageTo,
    toggle: (from?: HTMLElement | null) => slideOver.toggle(ASSISTANT_PANEL, from),
    close: (options?: { restoreFocus?: boolean }) => { if (slideOver.open.value === ASSISTANT_PANEL) slideOver.close(options) },
  }
}
