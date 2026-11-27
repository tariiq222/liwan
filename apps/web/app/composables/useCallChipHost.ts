import { computed, getCurrentInstance, onBeforeUnmount, shallowRef, watch, type Ref } from 'vue'
import { provideCallChip, type CallChipSeam } from '@liwan/ui/app/composables/useCallChip'
import { callChipSurface } from '../modules/surfaces'
import type { AppCallChipHandle, AppCallChipHostContext, AppCallChipSurface } from '../modules/types'
import { canReach } from '../utils/accessPolicy'
import { registerSessionTeardown } from '../utils/sessionTeardown'

export interface CallChipHostOptions {
  surface?: AppCallChipSurface | undefined
  context?: AppCallChipHostContext
  hydrated?: Ref<boolean>
  client?: boolean
}

/**
 * Shell-side host for the manifest-declared header call chip (design D3, R3).
 *
 * The layout mounts this once: it discovers the surface through `callChipSurface()` (importing no application code),
 * lazily loads the application's factory once hydrated and authorized, provides the `CALL_CHIP` seam, and tears it
 * down immediately on capability loss, user/company change, sign-out, company switch, or layout unmount.
 */
export function useCallChipHost(options: CallChipHostOptions = {}) {
  const surface = 'surface' in options ? options.surface : callChipSurface()
  const isClient = options.client ?? import.meta.client

  const context: AppCallChipHostContext = options.context ?? (() => {
    const { $api } = useApi()
    const { t } = useI18n()
    const { me } = useMe()
    const { can } = useAccess()
    const route = useRoute()
    return {
      $api,
      t: (key, params) => (params ? t(key, params) : t(key)),
      me,
      can,
      currentPath: () => route.fullPath,
    }
  })()

  const hydrated = options.hydrated ?? useHydrated()
  const seam = shallowRef<CallChipSeam | null>(null)
  provideCallChip(seam)

  const canUse = computed(() => Boolean(surface && context.me.value && canReach(context.me.value, surface.capability)))

  let activeHandle: AppCallChipHandle | null = null
  let activeKey: string | null = null
  let generation = 0

  async function teardown() {
    generation += 1
    activeKey = null
    seam.value = null
    const current = activeHandle
    activeHandle = null
    if (current) await current.stop()
  }

  async function mountFor(identityKey: string) {
    if (!surface) return
    const myGen = ++generation
    activeKey = identityKey
    try {
      const module = await surface.load()
      if (myGen !== generation) return
      const handle = module.createCallChip(context)
      if (myGen !== generation) {
        await handle.stop()
        return
      }
      activeHandle = handle
      seam.value = handle.seam
    } catch {
      if (myGen === generation) {
        activeKey = null
        seam.value = null
      }
    }
  }

  const unregisterTeardown = registerSessionTeardown(teardown)

  const stopWatch = watch(
    () => [hydrated.value, canUse.value, context.me.value?.id ?? null, context.me.value?.company.id ?? null] as const,
    ([ready, allowed, userId, companyId]) => {
      if (!isClient) return
      if (!ready || !allowed || userId === null || companyId === null) {
        if (activeHandle || activeKey !== null || seam.value) void teardown()
        return
      }
      const nextKey = `${userId}:${companyId}`
      if (activeKey === nextKey && activeHandle) return
      void (async () => {
        if (activeHandle || activeKey !== null) await teardown()
        if (hydrated.value && canUse.value && context.me.value?.id === userId && context.me.value?.company.id === companyId) {
          await mountFor(nextKey)
        }
      })()
    },
    { immediate: true },
  )

  function dispose() {
    stopWatch()
    unregisterTeardown()
    return teardown()
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => { void dispose() })
  }

  return { seam, canUse, teardown, dispose }
}
