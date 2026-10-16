export const VENDOR_CAPABILITIES = ['vendor.read', 'vendor.tenants.manage', 'vendor.catalog.manage', 'vendor.operations.run', 'vendor.audit.read', 'vendor.pricing.manage', 'vendor.subscriptions.manage', 'vendor.billing.manage', 'vendor.accounts.manage'] as const
export type VendorCapability = typeof VENDOR_CAPABILITIES[number]
export type VendorContext = { enabled: true; capabilities: VendorCapability[]; shared_onboarding_enabled?: boolean }
export type VendorContextError = { statusCode: number | null; code: string; message: string }
const NO_CONTEXT = { enabled: false, capabilities: [] as VendorCapability[] }

type ContextResult = { enabled: boolean; capabilities: VendorCapability[] }
type ContextFetcher = () => Promise<unknown>

function parseContext(value: unknown): VendorContext | null {
  if (!value || typeof value !== 'object') return null
  const context = value as { enabled?: unknown; capabilities?: unknown; shared_onboarding_enabled?: unknown }
  if (context.enabled !== true || !Array.isArray(context.capabilities)) return null
  if (!context.capabilities.every(item => VENDOR_CAPABILITIES.includes(item as VendorCapability))) return null
  return { enabled: true, capabilities: context.capabilities as VendorCapability[], ...(context.shared_onboarding_enabled === true ? { shared_onboarding_enabled: true } : {}) }
}

function serializeError(cause: unknown): VendorContextError {
  const value = cause as { statusCode?: unknown; status?: unknown; data?: { code?: unknown; message?: unknown }; message?: unknown } | null
  const status = value?.statusCode ?? value?.status
  return {
    statusCode: typeof status === 'number' ? status : null,
    code: typeof value?.data?.code === 'string' ? value.data.code : 'vendor_unavailable',
    message: typeof value?.data?.message === 'string' ? value.data.message : typeof value?.message === 'string' ? value.message : 'Vendor service is unavailable',
  }
}

// One in-flight load per app instance, shared by the route middleware and the pages.
const loads = new WeakMap<object, Promise<ContextResult>>()

/**
 * The vendor context state and its loading, with no route access and no watchers, so the route
 * middleware can use it. Pages use `useVendorContext`, which adds the actor-change watcher.
 */
export function useVendorContextState() {
  const { me, ready: meReady } = useAdminSession()
  const capabilities = useState<VendorCapability[]>('vendor:capabilities', () => [])
  const sharedOnboarding = useState<boolean>('vendor:shared-onboarding', () => false)
  const error = useState<VendorContextError | null>('vendor:context:error', () => null)
  const pending = useState<boolean>('vendor:context:pending', () => false)
  const owner = useState<number | null>('vendor:context:owner', () => null)
  const generation = useState<number>('vendor:context:generation', () => 0)

  function clear(actorId: number | null) {
    capabilities.value = []; sharedOnboarding.value = false
    owner.value = actorId
  }

  /** Fetches the context for the signed-in account now. */
  async function load(fetchContext: ContextFetcher): Promise<ContextResult> {
    await meReady
    const actorId = me.value?.id ?? null
    if (actorId === null) {
      clear(null)
      error.value = null
      return NO_CONTEXT
    }
    if (owner.value !== null && owner.value !== actorId) clear(actorId)
    owner.value = actorId
    const requestGeneration = ++generation.value
    pending.value = true
    try {
      const parsed = parseContext(await fetchContext())
      if (!parsed) throw new Error('Invalid vendor context response')
      if (me.value?.id !== actorId || requestGeneration !== generation.value) return NO_CONTEXT
      capabilities.value = parsed.capabilities
      sharedOnboarding.value = parsed.shared_onboarding_enabled === true
      error.value = null
      return parsed
    } catch (cause) {
      if (requestGeneration === generation.value) {
        clear(actorId)
        error.value = serializeError(cause)
      }
      return NO_CONTEXT
    } finally {
      if (requestGeneration === generation.value) pending.value = false
    }
  }

  /** Loads only when the signed-in account is not the one the state belongs to, or the last load failed. */
  async function ensure(fetchContext: ContextFetcher): Promise<void> {
    await meReady
    const actorId = me.value?.id ?? null
    if (actorId === null) { await load(fetchContext); return }
    if (owner.value === actorId && !error.value) return
    let inflight = loads.get(generation)
    if (!inflight) {
      inflight = load(fetchContext).finally(() => loads.delete(generation))
      loads.set(generation, inflight)
    }
    await inflight
  }

  /** The signed-in account changed: drop the previous grants at once. */
  function actorChanged(actorId: number | null) {
    generation.value++
    clear(actorId)
    if (actorId === null) { pending.value = false; error.value = null }
  }

  const ownsState = () => owner.value === (me.value?.id ?? null)
  const can = (capability: VendorCapability) => ownsState() && capabilities.value.includes(capability)
  return {
    me, owner, load, ensure, actorChanged, can,
    capabilities: computed(() => capabilities.value),
    sharedOnboardingEnabled: computed(() => ownsState() && sharedOnboarding.value),
    pending: computed(() => pending.value),
    error: computed(() => error.value),
  }
}

export function useVendorContext() {
  const state = useVendorContextState()
  const { request } = useVendorApi()
  const fetchContext = () => request<unknown>('context')
  const refresh = () => state.load(fetchContext)
  const ready = state.ensure(fetchContext)

  watch(() => state.me.value?.id ?? null, (actorId, previous) => {
    if (actorId === previous || state.owner.value === actorId) return
    state.actorChanged(actorId)
    if (actorId !== null) void refresh()
  })

  const { can, capabilities, sharedOnboardingEnabled, pending, error } = state
  return { sharedOnboardingEnabled, capabilities, can, pending, error, ready, refresh }
}
