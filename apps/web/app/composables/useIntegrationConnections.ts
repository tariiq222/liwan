import type { MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  IntegrationConnectionListSchema,
  IntegrationConnectionSchema,
  IntegrationSecretRotationSchema,
  type IntegrationConnection,
  type IntegrationConnectionCreate,
  type IntegrationConnectionList,
  type IntegrationConnectionUpdate,
} from '@liwan/contracts'
import { dropConnection, storeConnection } from '../utils/integrationConnections'

export const integrationConnectionKeys = {
  all: ['integrations', 'connections'] as const,
  detail: (id: number) => ['integrations', 'connections', id] as const,
}

export function useIntegrationConnections(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: integrationConnectionKeys.all,
    enabled,
    queryFn: () => $api('/api/v1/integrations/connections', { schema: IntegrationConnectionListSchema }),
    retry: false,
  })
}

/** One stored connection; `id` is null while the route has no valid id. */
export function useIntegrationConnection(id: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => integrationConnectionKeys.detail(toValue(id) ?? 0)),
    enabled: () => toValue(enabled) && toValue(id) !== null,
    queryFn: () => $api(`/api/v1/integrations/connections/${toValue(id)}`, { schema: IntegrationConnectionSchema }),
    retry: false,
  })
}

// The server's answer replaces the cached connection in the list and in its own entry. An older read still in flight
// is cancelled first, so it cannot bring the previous state back over the answer.
function useStoreConnection() {
  const qc = useQueryClient()
  return async (connection: IntegrationConnection) => {
    await qc.cancelQueries({ queryKey: integrationConnectionKeys.all })
    qc.setQueryData<IntegrationConnectionList | undefined>(integrationConnectionKeys.all, list => storeConnection(list, connection))
    if (connection.id !== null) qc.setQueryData(integrationConnectionKeys.detail(connection.id), connection)
  }
}

/** Connect an account of a `keys` provider. The server probes it before answering; a refusal stores nothing. */
export function useCreateIntegrationConnection() {
  const { $api } = useApi()
  const store = useStoreConnection()
  return useMutation({
    mutationFn: (body: IntegrationConnectionCreate) =>
      $api('/api/v1/integrations/connections', { method: 'POST', body, schema: IntegrationConnectionSchema }),
    onSuccess: store,
  })
}

/** Change the label or the app id, replace secrets, switch the connection off or ask for a new check. */
export function useUpdateIntegrationConnection() {
  const { $api } = useApi()
  const store = useStoreConnection()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: IntegrationConnectionUpdate }) =>
      $api(`/api/v1/integrations/connections/${id}`, { method: 'PATCH', body, schema: IntegrationConnectionSchema }),
    onSuccess: store,
  })
}

/** Check the connection with the provider; the answer carries the new state. */
export function useTestIntegrationConnection() {
  const { $api } = useApi()
  const store = useStoreConnection()
  return useMutation({
    mutationFn: (id: number) =>
      $api(`/api/v1/integrations/connections/${id}/test`, { method: 'POST', body: {}, schema: IntegrationConnectionSchema }),
    onSuccess: store,
  })
}

/** Rotate a generated secret. The answer is the only time its value travels; the page shows it once and never caches it. */
export function useRotateIntegrationSecret() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      $api(`/api/v1/integrations/connections/${id}/secrets/${name}/rotate`, { method: 'POST', body: {}, schema: IntegrationSecretRotationSchema }),
    onSuccess: (_rotation, { id }) => qc.invalidateQueries({ queryKey: integrationConnectionKeys.detail(id) }),
  })
}

/** Disconnect. A connection an application still uses is refused (409 `in_use`) and stays. */
export function useDeleteIntegrationConnection() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => $api<void>(`/api/v1/integrations/connections/${id}`, { method: 'DELETE' }),
    onSuccess: (_result, id) => {
      qc.setQueryData<IntegrationConnectionList | undefined>(integrationConnectionKeys.all, list => dropConnection(list, `connection:${id}`))
      qc.removeQueries({ queryKey: integrationConnectionKeys.detail(id) })
    },
  })
}
