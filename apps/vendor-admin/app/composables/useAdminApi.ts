const API_PREFIX = '/api/vendor/v1'

type Fetcher = (url: string, options?: Record<string, unknown>) => Promise<unknown>

export interface AdminApiDeps {
  fetcher: Fetcher
  onUnauthorized: () => void | Promise<void>
  /** Hook point for the step-up flow: receives a retry of the failed request. Default: rethrow. */
  onStepUpRequired?: <T>(retry: () => Promise<T>, cause: unknown) => Promise<T>
}

function failureOf(error: unknown): { status?: number, code?: string } {
  const e = error as { statusCode?: number, response?: { status?: number }, data?: { code?: string } } | null
  return { status: e?.statusCode ?? e?.response?.status, code: e?.data?.code }
}

export function createAdminApi({ fetcher, onUnauthorized, onStepUpRequired }: AdminApiDeps) {
  async function request<T>(path: string, options?: Record<string, unknown>): Promise<T> {
    if (!path.startsWith('/')) throw new Error('invalid_path')
    const send = () => fetcher(`${API_PREFIX}${path}`, options) as Promise<T>
    try {
      return await send()
    } catch (error) {
      const { status, code } = failureOf(error)
      if (status === 401) await onUnauthorized()
      else if (status === 403 && code === 'step_up_required' && onStepUpRequired) return onStepUpRequired(send, error)
      throw error
    }
  }
  return { request }
}

export function useAdminApi() {
  const me = useAdminMe()
  const route = useRoute()
  return createAdminApi({
    fetcher: $fetch as Fetcher,
    onUnauthorized: () => {
      me.value = null
      return navigateTo({ path: '/login', query: { next: route.fullPath } })
    },
  })
}
