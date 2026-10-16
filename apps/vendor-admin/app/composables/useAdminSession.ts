export interface AdminMe {
  id: number
  email: string
  display_name: string
  roles: string[]
  capabilities: string[]
}

// One load per app instance, shared by every caller of useAdminSession().
const loads = new WeakMap<object, Promise<void>>()

function statusOf(error: unknown): number | undefined {
  const e = error as { statusCode?: number, response?: { status?: number } } | null
  return e?.statusCode ?? e?.response?.status
}

/** The signed-in profile alone, without triggering a load. */
export function useAdminMe() {
  return useState<AdminMe | null>('admin-me', () => null)
}

export function useAdminSession() {
  const me = useAdminMe()
  const loaded = useState<boolean>('admin-me-loaded', () => false)
  const fetcher = useRequestFetch()

  async function refresh(): Promise<void> {
    try {
      me.value = await fetcher<AdminMe>('/api/auth/session')
    } catch (error) {
      if (statusOf(error) !== 401) throw error
      me.value = null
    }
    loaded.value = true
  }

  function load(): Promise<void> {
    if (loaded.value) return Promise.resolve()
    let pending = loads.get(loaded)
    if (!pending) {
      pending = refresh().finally(() => loads.delete(loaded))
      loads.set(loaded, pending)
    }
    return pending
  }

  async function signOut(): Promise<void> {
    try {
      await $fetch('/api/auth/logout', { method: 'POST', body: {} })
    } finally {
      me.value = null
    }
    await navigateTo('/login')
  }

  const can = (capability: string): boolean => me.value?.capabilities.includes(capability) ?? false

  return {
    me,
    // Read on demand: pages that must not call the BFF on arrival (enrollment) take only `refresh`.
    get ready() { return load() },
    can,
    refresh,
    signOut,
  }
}
