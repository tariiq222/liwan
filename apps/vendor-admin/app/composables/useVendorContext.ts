export const VENDOR_CAPABILITIES = ['vendor.read', 'vendor.tenants.manage', 'vendor.catalog.manage', 'vendor.operations.run', 'vendor.audit.read', 'vendor.pricing.manage', 'vendor.subscriptions.manage', 'vendor.billing.manage', 'vendor.accounts.manage'] as const
export type VendorCapability = typeof VENDOR_CAPABILITIES[number]
export type VendorContext = { enabled: true; capabilities: VendorCapability[]; shared_onboarding_enabled?: boolean }
export type VendorContextError = { statusCode: number | null; code: string; message: string }
const EMPTY_CONTEXT = { enabled: false, capabilities: [] as VendorCapability[] }

function parseContext(value: unknown): VendorContext | null {
  if (!value || typeof value !== 'object') return null
  const context = value as { enabled?: unknown; capabilities?: unknown; shared_onboarding_enabled?: unknown }
  if (context.enabled !== true || !Array.isArray(context.capabilities)) return null
  if (!context.capabilities.every(item => VENDOR_CAPABILITIES.includes(item as VendorCapability))) return null
  return { enabled: true, capabilities: context.capabilities as VendorCapability[], ...(context.shared_onboarding_enabled === true ? { shared_onboarding_enabled: true } : {}) }
}

export function useVendorContext() {
  const { me, ready: meReady } = useAdminSession()
  const { request } = useVendorApi()
  const capabilities = useState<VendorCapability[]>('vendor:capabilities', () => [])
  const sharedOnboarding = useState<boolean>('vendor:shared-onboarding', () => false)
  const error = useState<VendorContextError | null>('vendor:context:error', () => null)
  const pending = useState<boolean>('vendor:context:pending', () => false)
  const owner = useState<number | null>('vendor:context:owner', () => null)
  const generation = useState<number>('vendor:context:generation', () => 0)

  function serializeError(cause: unknown): VendorContextError {
    const value = cause as { statusCode?: unknown; status?: unknown; data?: { code?: unknown; message?: unknown }; message?: unknown } | null
    const status = value?.statusCode ?? value?.status
    return {
      statusCode: typeof status === 'number' ? status : null,
      code: typeof value?.data?.code === 'string' ? value.data.code : 'vendor_unavailable',
      message: typeof value?.data?.message === 'string' ? value.data.message : typeof value?.message === 'string' ? value.message : 'Vendor service is unavailable',
    }
  }

  async function refresh(): Promise<{ enabled: boolean; capabilities: VendorCapability[] }> {
    await meReady
    const actorId = me.value?.id ?? null
    if (actorId === null) {
      capabilities.value = []; sharedOnboarding.value = false
      owner.value = actorId
      error.value = null
      return { enabled: false, capabilities: [] }
    }
    if (owner.value !== null && owner.value !== actorId) { capabilities.value = []; sharedOnboarding.value = false }
    owner.value = actorId
    const requestGeneration = ++generation.value
    pending.value = true
    try {
      const parsed = parseContext(await request<unknown>('context'))
      if (!parsed) throw new Error('Invalid vendor context response')
      if (me.value?.id !== actorId || requestGeneration !== generation.value) return { enabled: false, capabilities: [] }
      capabilities.value = parsed.capabilities
      sharedOnboarding.value = parsed.shared_onboarding_enabled === true
      error.value = null
      return parsed
    } catch (cause) {
      if (requestGeneration === generation.value) {
        capabilities.value = []; sharedOnboarding.value = false
        error.value = serializeError(cause)
      }
      return { enabled: false, capabilities: [] }
    } finally {
      if (requestGeneration === generation.value) pending.value = false
    }
  }

  const ready = useAsyncData('vendor:context', refresh, {
    lazy: true,
    dedupe: 'defer',
    default: () => EMPTY_CONTEXT,
  })

  watch(() => me.value?.id ?? null, (actorId, previous) => {
    if (actorId === previous) return
    if (owner.value === actorId) return
    generation.value++
    capabilities.value = []; sharedOnboarding.value = false
    owner.value = actorId
    if (actorId !== null) void refresh()
    else { pending.value = false; error.value = null }
  })

  const can = (capability: VendorCapability) => owner.value === (me.value?.id ?? null) && capabilities.value.includes(capability)
  return { sharedOnboardingEnabled: computed(() => owner.value === (me.value?.id ?? null) && sharedOnboarding.value), capabilities: computed(() => capabilities.value), can, pending: computed(() => pending.value), error: computed(() => error.value), ready, refresh }
}
