import { useQueryClient, type DehydratedState, type QueryClient } from '@tanstack/vue-query'
import { onServerPrefetch } from 'vue'
import { ApiError } from '../composables/useApi'

type DehydratedQuery = DehydratedState['queries'][number]
export type SerializedDehydratedState = Omit<DehydratedState, 'queries'> & {
  queries: (Omit<DehydratedQuery, 'state'> & {
    state: Omit<DehydratedQuery['state'], 'error' | 'fetchFailureReason'> & {
      error: unknown
      fetchFailureReason: unknown
    }
  })[]
}

const API_ERROR_MARKER = '__nasq_api_error__'
const ERROR_MARKER = '__nasq_error__'

/**
 * Wait for the queries that a component started during SSR.
 *
 * Vue Query's regular `useQuery()` path starts an observer fetch, but it does
 * not register a Vue `serverPrefetch` callback.  Nuxt can therefore render
 * while that fetch is still pending and dehydrate its result after the render
 * has changed the cache.  The app-level server-prefetch mixin calls this
 * helper once per component.  A second pass matters for queries enabled by a
 * result from the first pass (for example, a dependent query).
 */
export async function settleServerQueries(queryClient: QueryClient): Promise<void> {
  const maxPasses = 16

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const pending = queryClient.getQueryCache().getAll()
      .filter(query => query.state.fetchStatus === 'fetching')
      .map(query => query.promise)
      .filter((promise): promise is Promise<unknown> => Boolean(promise))

    if (!pending.length) return

    // A failed query must become an error result for SSR to render it. The
    // rejection is intentionally contained here; Query itself records the
    // failure and the dehydrated error state is handled by the plugin.
    await Promise.allSettled(pending)

    // Let Vue Query's cache notifications and dependent-query watchers run
    // before taking the next snapshot of the cache.
    await Promise.resolve()
  }
}

/** Seed refs whose ordinary immediate watcher cannot rerun during SSR. */
export function useSsrQuerySeed<T>(
  query: { data: { value: T | undefined } },
  seed: (data: T) => void,
): void {
  const queryClient = useQueryClient()
  onServerPrefetch(async () => {
    // Disabled queries have no request to await. Calling suspense() on one
    // would leave SSR pending forever (for example, a new meeting without a series).
    await settleServerQueries(queryClient)
    if (query.data.value !== undefined) seed(query.data.value)
  })
}

function serializeQueryError(error: unknown): unknown {
  if (error instanceof ApiError) {
    return {
      [API_ERROR_MARKER]: true,
      status: error.status,
      code: error.code,
      message: error.message,
      field: error.field,
      details: error.details,
    }
  }
  if (error instanceof Error) {
    return { [ERROR_MARKER]: true, name: error.name, message: error.message }
  }
  return error
}

function restoreQueryError(error: unknown): Error | null {
  if (error == null) return null
  if (error instanceof Error) return error
  if (typeof error !== 'object') return new Error(String(error))
  const value = error as Record<string, unknown>
  if (value[API_ERROR_MARKER] === true) {
    return new ApiError(
      Number(value.status),
      String(value.code),
      String(value.message),
      typeof value.field === 'string' ? value.field : undefined,
      value.details && typeof value.details === 'object' ? value.details as Record<string, unknown> : undefined,
    )
  }
  if (value[ERROR_MARKER] === true) {
    const restored = new Error(String(value.message))
    restored.name = String(value.name || 'Error')
    return restored
  }
  return new Error(typeof value.message === 'string' ? value.message : 'Query failed')
}

/** Keep structured API errors intact across Nuxt's JSON payload boundary. */
export function serializeDehydratedErrors(state: DehydratedState): SerializedDehydratedState {
  return {
    ...state,
    queries: state.queries.map(query => query.state.error == null && query.state.fetchFailureReason == null
      ? query
      : {
          ...query,
          state: {
            ...query.state,
            error: serializeQueryError(query.state.error),
            fetchFailureReason: serializeQueryError(query.state.fetchFailureReason),
          },
        }),
  }
}

export function restoreDehydratedErrors(state: SerializedDehydratedState): DehydratedState {
  return {
    ...state,
    queries: state.queries.map(query => ({
          ...query,
          state: {
            ...query.state,
            error: restoreQueryError(query.state.error),
            fetchFailureReason: restoreQueryError(query.state.fetchFailureReason),
          },
        })),
  }
}
