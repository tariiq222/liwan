<script setup lang="ts">
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { loadRouteLocation } from 'vue-router'
import ProjectRouteModal from '@/components/project/workspace/ProjectRouteModal.vue'
import {
  wantsProjectOverlayFullPage,
} from '@/utils/projectOverlayRoute'
import { deriveWorkspaceOverlayBackground, isWorkspaceOverlayRoute, isWorkspaceOverlayBackground } from '@/utils/workspacePresentation'

const router = useRouter()
// Nuxt's useRoute intentionally updates after page navigation settles. The
// host must observe the live router transition so a click from a mounted
// project workspace opens its route-backed dialog immediately.
const route = router.currentRoute

const modalOpen = computed(() => isWorkspaceOverlayRoute({
  path: route.value.path,
  query: route.value.query as Record<string, unknown>,
}) && !wantsProjectOverlayFullPage(route.value.query as Record<string, unknown>))

const backgroundFullPath = ref<string | null>(null)
const cachedModalRoute = shallowRef<RouteLocationNormalizedLoaded | null>(null)
const modalMounted = ref(false)
let previouslyFocused: HTMLElement | null = null
let closePending = false
const hostElement = ref<HTMLElement | null>(null)
const frame = ref({ top: 0, left: 0, width: 0, height: 0, sheetWidth: 0, radius: '24px', enter: '100vw', exit: '-100vw', side: 'right' as 'left' | 'right' })
let frameObserver: ResizeObserver | null = null
let directionObserver: MutationObserver | null = null
let frameRequest: number | null = null
let contextSidebarElement: HTMLElement | null = null
let contextSidebarWasInert = false

const frameStyle = computed(() => ({
  top: `${frame.value.top}px`,
  left: `${frame.value.left}px`,
  width: `${frame.value.width}px`,
  height: `${frame.value.height}px`,
  '--project-overlay-enter': frame.value.enter,
  '--project-overlay-exit': frame.value.exit,
  'border-start-start-radius': frame.value.radius,
}))
const sheetWidth = computed(() => `${frame.value.sheetWidth}px`)
const overlayVisible = computed(() => modalOpen.value || modalMounted.value)

function routeFor(fullPath: string): RouteLocationNormalizedLoaded {
  return router.resolve(fullPath) as RouteLocationNormalizedLoaded
}

function backgroundForCurrentRoute(): string {
  return deriveWorkspaceOverlayBackground(route.value.path, route.value.query as Record<string, unknown>)
}

const backgroundRoute = computed(() => {
  if (!modalOpen.value) return route.value as RouteLocationNormalizedLoaded
  return routeFor(backgroundFullPath.value || backgroundForCurrentRoute())
})
const modalRoute = computed(() => route.value as RouteLocationNormalizedLoaded)
// Use the same key before and after opening so the original project page
// remains mounted while the workflow route is presented above it.
const backgroundPageKey = computed(() => `project-page:${backgroundRoute.value.path}`)
const loadedBackgroundRoute = shallowRef<RouteLocationNormalizedLoaded | null>(null)
let backgroundLoad: Promise<void> = Promise.resolve()
let backgroundGeneration = 0
watch(backgroundRoute, target => {
  const generation = ++backgroundGeneration
  if (!modalOpen.value) {
    loadedBackgroundRoute.value = target
    return
  }
  // router.resolve() does not load lazy page components. Resolve them before
  // passing a direct-link fallback to NuxtPage (otherwise it renders a Promise).
  backgroundLoad = loadRouteLocation(target).then(loaded => {
    if (generation === backgroundGeneration) loadedBackgroundRoute.value = loaded
  }).catch(() => {
    if (generation === backgroundGeneration) loadedBackgroundRoute.value = null
  })
}, { immediate: true })
// Match the server's loaded background on the initial client render as well.
await backgroundLoad

function restoreFocus() {
  const focusTarget = previouslyFocused
  previouslyFocused = null
  nextTick(() => {
    if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true })
  })
}

function syncContextSidebarInert(open: boolean) {
  if (!import.meta.client) return
  const sidebar = document.querySelector<HTMLElement>('[data-testid="context-sidebar"]')
  if (open) {
    if (!sidebar) return
    if (contextSidebarElement !== sidebar) {
      contextSidebarElement = sidebar
      contextSidebarWasInert = sidebar.hasAttribute('inert')
    }
    sidebar.setAttribute('inert', '')
    return
  }
  if (contextSidebarElement && !contextSidebarWasInert) contextSidebarElement.removeAttribute('inert')
  contextSidebarElement = null
  contextSidebarWasInert = false
}

function updateFrame() {
  if (!import.meta.client) return
  const main = hostElement.value?.closest<HTMLElement>('[data-testid="shell-main"]')
  if (!main) return

  const header = document.querySelector<HTMLElement>('[data-testid="shell-header"]')
  const rail = document.querySelector<HTMLElement>('[data-testid="module-rail"]')
  const headerRect = header?.getBoundingClientRect()
  const measuredRail = rail?.getBoundingClientRect()
  const railRect = measuredRail?.width ? measuredRail : undefined
  const mainStyles = getComputedStyle(main)
  const radius = mainStyles.getPropertyValue('border-start-start-radius').trim() || (window.innerWidth <= 767 ? '18px' : '24px')
  const top = Math.max(headerRect?.bottom ?? 0, 0)
  const bottom = window.innerHeight
  const renderedDirection = getComputedStyle(rail || main).direction
  const rtl = renderedDirection === 'rtl'
  const railBoundary = rtl ? (railRect?.left ?? window.innerWidth) : (railRect?.right ?? 0)
  const left = rtl ? 0 : Math.min(window.innerWidth, railBoundary)
  const right = rtl ? Math.max(0, railBoundary) : window.innerWidth
  const availableWidth = Math.max(0, right - left)
  const renderedPath = cachedModalRoute.value?.path || route.value.path
  const compact = /\/tasks\/new$/.test(renderedPath)
  const wide = /(?:\/charter$|\/finance\/(?:new|[1-9]\d*(?:\/edit)?)$|^\/project-templates\/(?:new|[1-9]\d*(?:\/edit|\/apply)?)$)/.test(renderedPath)
  const targetSheetWidth = compact ? 560 : wide ? 900 : 800
  frame.value = {
    top,
    left,
    width: availableWidth,
    height: Math.max(0, bottom - top),
    sheetWidth: window.innerWidth < 768 ? availableWidth : Math.min(targetSheetWidth, availableWidth),
    radius,
    // Dock opposite the module rail (inline-end): enter from that edge, leave the other way.
    side: rtl ? 'left' : 'right',
    enter: rtl ? `-${availableWidth}px` : `${availableWidth}px`,
    exit: rtl ? `${availableWidth}px` : `-${availableWidth}px`,
  }
  syncContextSidebarInert(overlayVisible.value)
}

function scheduleFrameUpdate() {
  if (!import.meta.client || frameRequest !== null) return
  frameRequest = requestAnimationFrame(() => {
    frameRequest = null
    updateFrame()
  })
}

watch(
  () => route.value.fullPath,
  (_, previous) => {
    if (!modalOpen.value) {
      backgroundFullPath.value = null
      return
    }
    if (backgroundFullPath.value) {
      // Nested workflows replace the current sheet. Crossing modules must
      // also replace its retained section, rather than exposing stale context.
      const candidate = deriveWorkspaceOverlayBackground(route.value.path, {
        ...route.value.query, returnTo: backgroundFullPath.value,
      })
      if (candidate === backgroundFullPath.value) return
      backgroundFullPath.value = backgroundForCurrentRoute()
      return
    }
    backgroundFullPath.value = previous && (route.value.path.startsWith('/projects') || route.value.path.startsWith('/project-templates') || isWorkspaceOverlayBackground(route.value.path, previous)) && !isWorkspaceOverlayRoute({
      path: router.resolve(previous).path,
      query: router.resolve(previous).query as Record<string, unknown>,
    })
      ? previous
      : backgroundForCurrentRoute()
  },
  { immediate: true },
)

watch(modalOpen, (open, wasOpen) => {
  if (open === wasOpen) return
  if (open) {
    if (!backgroundFullPath.value) backgroundFullPath.value = backgroundForCurrentRoute()
    cachedModalRoute.value = route.value as RouteLocationNormalizedLoaded
    modalMounted.value = true
    if (import.meta.client) previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    nextTick(scheduleFrameUpdate)
  }
}, { immediate: true })

watch(
  () => route.value.fullPath,
  () => {
    if (!modalOpen.value) return
    cachedModalRoute.value = route.value as RouteLocationNormalizedLoaded
    modalMounted.value = true
    nextTick(scheduleFrameUpdate)
  },
)

onMounted(() => {
  scheduleFrameUpdate()
  const main = hostElement.value?.closest<HTMLElement>('[data-testid="shell-main"]')
  frameObserver = typeof ResizeObserver !== 'undefined' && main ? new ResizeObserver(scheduleFrameUpdate) : null
  if (main) frameObserver?.observe(main)
  const header = document.querySelector<HTMLElement>('[data-testid="shell-header"]')
  const rail = document.querySelector<HTMLElement>('[data-testid="module-rail"]')
  if (header) frameObserver?.observe(header)
  if (rail) frameObserver?.observe(rail)
  directionObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(scheduleFrameUpdate) : null
  directionObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['dir', 'data-direction'], subtree: true })
  window.addEventListener('resize', scheduleFrameUpdate)
  window.addEventListener('scroll', scheduleFrameUpdate, true)
})

watch(overlayVisible, syncContextSidebarInert, { immediate: true })

function finishClose() {
  if (modalOpen.value) return
  modalMounted.value = false
  cachedModalRoute.value = null
  backgroundFullPath.value = null
  syncContextSidebarInert(false)
  restoreFocus()
}

onBeforeUnmount(() => {
  frameObserver?.disconnect()
  frameObserver = null
  directionObserver?.disconnect()
  directionObserver = null
  if (frameRequest !== null) {
    cancelAnimationFrame(frameRequest)
    frameRequest = null
  }
  if (import.meta.client) {
    window.removeEventListener('resize', scheduleFrameUpdate)
    window.removeEventListener('scroll', scheduleFrameUpdate, true)
  }
  syncContextSidebarInert(false)
})

async function close() {
  if (closePending) return
  closePending = true
  try {
    await router.push(backgroundFullPath.value || backgroundForCurrentRoute())
  } finally {
    closePending = false
  }
}
</script>

<template>
  <div
    ref="hostElement"
    data-project-route-host
    data-workspace-route-host
    :data-project-modal-open="modalOpen ? 'true' : 'false'"
  >
    <div
      data-project-background
      :aria-hidden="overlayVisible ? 'true' : undefined"
      :inert="overlayVisible"
    >
      <NuxtPage v-if="loadedBackgroundRoute" :route="loadedBackgroundRoute" :page-key="backgroundPageKey" />
    </div>
    <ProjectRouteModal
      v-if="modalMounted && frame.width > 0 && frame.height > 0"
      :route="cachedModalRoute || modalRoute"
      :open="modalOpen"
      :frame-style="frameStyle"
      :sheet-width="sheetWidth"
      :side="frame.side"
      @close="close"
      @after-leave="finishClose"
    />
  </div>
</template>
