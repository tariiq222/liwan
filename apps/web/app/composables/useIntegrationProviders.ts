import type { MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { IntegrationOAuthStartResponseSchema, IntegrationProviderListSchema, type IntegrationOAuthStart } from '@liwan/contracts'

export const integrationProviderKeys = {
  all: ['integrations', 'providers'] as const,
}

export function useIntegrationProviders(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: integrationProviderKeys.all,
    enabled,
    queryFn: () => $api('/api/v1/integrations/providers', { schema: IntegrationProviderListSchema }),
    retry: false,
  })
}

/** Ask the server where the customer authorizes the account at the provider; the caller sends the browser there. */
export function useStartIntegrationOAuth() {
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ provider, body }: { provider: string; body: IntegrationOAuthStart }) =>
      $api(`/api/v1/integrations/oauth/${provider}/start`, { method: 'POST', body, schema: IntegrationOAuthStartResponseSchema }),
  })
}
