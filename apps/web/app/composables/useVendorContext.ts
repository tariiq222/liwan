export const VENDOR_CAPABILITIES = ['vendor.read', 'vendor.tenants.manage', 'vendor.catalog.manage', 'vendor.operations.run', 'vendor.audit.read'] as const
export type VendorCapability = typeof VENDOR_CAPABILITIES[number]
export type VendorContext = { enabled: true; capabilities: VendorCapability[] }
export type VendorContextError = { statusCode: number | null; code: string; message: string }
const EMPTY_CONTEXT = { enabled: false, capabilities: [] as VendorCapability[] }

function parseContext(value: unknown): VendorContext | null {
  if (!value || typeof value !== 'object') return null
  const context = value as { enabled?: unknown; capabilities?: unknown }
  if (context.enabled !== true || !Array.isArray(context.capabilities)) return null
  if (!context.capabilities.every(item => VENDOR_CAPABILITIES.includes(item as VendorCapability))) return null
  return { enabled: true, capabilities: context.capabilities as VendorCapability[] }
}

export function useVendorContext() {
  const config = useRuntimeConfig()
  const publicFlag: unknown = config.public.vendorWorkspaceEnabled
  const enabled = publicFlag === true || publicFlag === 'true'
  const { me, ready: meReady } = useMe()
  const capabilities = useState<VendorCapability[]>('vendor:capabilities', () => [])
  const error = useState<VendorContextError | null>('vendor:context:error', () => null)
  const pending = useState<boolean>('vendor:context:pending', () => false)
  const owner = useState<number | null>('vendor:context:owner', () => null)
  const generation = useState<number>('vendor:context:generation', () => 0)
  const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

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
    if (!enabled || actorId === null) {
      capabilities.value = []
      owner.value = actorId
      error.value = null
      return { enabled: false, capabilities: [] }
    }
    if (owner.value !== null && owner.value !== actorId) capabilities.value = []
    owner.value = actorId
    const requestGeneration = ++generation.value
    pending.value = true
    try {
      const parsed = parseContext(await $fetch<unknown>('/api/vendor/v1/context', { headers: requestHeaders }))
      if (!parsed) throw new Error('Invalid vendor context response')
      if (me.value?.id !== actorId || requestGeneration !== generation.value) return { enabled: false, capabilities: [] }
      capabilities.value = parsed.capabilities
      error.value = null
      return parsed
    } catch (cause) {
      if (requestGeneration === generation.value) {
        capabilities.value = []
        error.value = serializeError(cause)
      }
      return { enabled: false, capabilities: [] }
    } finally {
      if (requestGeneration === generation.value) pending.value = false
    }
  }

  const ready = useAsyncData('vendor:context', refresh, {
    server: enabled,
    lazy: true,
    dedupe: 'defer',
    default: () => EMPTY_CONTEXT,
  })

  watch(() => me.value?.id ?? null, (actorId, previous) => {
    if (actorId === previous) return
    if (owner.value === actorId) return
    generation.value++
    capabilities.value = []
    owner.value = actorId
    if (actorId !== null && enabled) void refresh()
    else { pending.value = false; error.value = null }
  })

  const can = (capability: VendorCapability) => enabled && owner.value === (me.value?.id ?? null) && capabilities.value.includes(capability)
  return { enabled, capabilities: computed(() => capabilities.value), can, pending: computed(() => pending.value), error: computed(() => error.value), ready, refresh }
}
