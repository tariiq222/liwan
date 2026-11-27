import { computed, getCurrentInstance, onBeforeUnmount, shallowRef, watch, type Ref } from 'vue'
import { provideCallChip, type CallChipSeam } from '@liwan/ui/app/composables/useCallChip'
import { callChipSurface } from '../modules/surfaces'
import type { AppCallChipHandle, AppCallChipHostContext, AppCallChipSurface } from '../modules/types'
import { canReach } from '../utils/accessPolicy'
import { registerSessionTeardown } from '../utils/sessionTeardown'

export interface CallChipStopOptions {
  revoke?: boolean
  notifyTeardown?: boolean
  releaseFailover?: boolean
}

const SESSION_TEARDOWN_OPTIONS: CallChipStopOptions = {
  revoke: true,
  notifyTeardown: true,
  releaseFailover: false,
}

const UNMOUNT_STOP_OPTIONS: CallChipStopOptions = {
  revoke: false,
  notifyTeardown: false,
  releaseFailover: true,
}

type StopHandleWithOptions = (options?: CallChipStopOptions) => Promise<void>

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
 *
 * Layout unmount releases tab leadership for sibling failover without revoking the server session or broadcasting
 * session teardown; only session-ending transitions (logout, company switch, capability/identity loss) revoke and
 * broadcast teardown.
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
  let disposed = false

  async function stopHandle(handle: AppCallChipHandle, stopOptions: CallChipStopOptions) {
    await (handle.stop as StopHandleWithOptions)(stopOptions)
  }

  async function teardown(stopOptions: CallChipStopOptions = SESSION_TEARDOWN_OPTIONS) {
    generation += 1
    activeKey = null
    seam.value = null
    const current = activeHandle
    activeHandle = null
    if (current) await stopHandle(current, stopOptions)
  }

  async function mountFor(identityKey: string) {
    if (!surface || disposed) return
    const myGen = ++generation
    activeKey = identityKey
    try {
      const module = await surface.load()
      if (myGen !== generation || disposed) return
      const handle = module.createCallChip(context)
      if (myGen !== generation || disposed) {
        await stopHandle(handle, { revoke: false, notifyTeardown: false, releaseFailover: false })
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

  async function sync() {
    if (disposed || !isClient) return
    const ready = hydrated.value
    const allowed = canUse.value
    const userId = context.me.value?.id ?? null
    const companyId = context.me.value?.company.id ?? null

    if (!ready || !allowed || userId === null || companyId === null) {
      if (activeHandle || activeKey !== null || seam.value) await teardown(SESSION_TEARDOWN_OPTIONS)
      return
    }
    const nextKey = `${userId}:${companyId}`
    if (activeKey === nextKey) return
    if (activeHandle || activeKey !== null) await teardown(SESSION_TEARDOWN_OPTIONS)
    if (!disposed && hydrated.value && canUse.value && context.me.value?.id === userId && context.me.value?.company.id === companyId) {
      await mountFor(nextKey)
    }
  }

  const unregisterTeardown = registerSessionTeardown({
    teardown: () => teardown(SESSION_TEARDOWN_OPTIONS),
    restore: () => sync(),
  })

  const stopWatch = watch(
    () => [hydrated.value, canUse.value, context.me.value?.id ?? null, context.me.value?.company.id ?? null] as const,
    () => { void sync() },
    { immediate: true },
  )

  function dispose() {
    disposed = true
    stopWatch()
    unregisterTeardown()
    return teardown(UNMOUNT_STOP_OPTIONS)
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => { void dispose() })
  }

  return { seam, canUse, teardown, dispose }
}
