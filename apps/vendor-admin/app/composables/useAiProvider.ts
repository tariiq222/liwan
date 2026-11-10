import type { AiProviderCurrent, AiProviderModels, AiProviderPresetList, AiProviderSave, AiProviderTestResult } from '@liwan/commercial-contracts'

type Request = <T>(path: string, options?: { method?: string, body?: unknown }) => Promise<T>

const ROOT = 'platform/ai-provider'

/** The platform AI calls. A key is only ever sent (in a save), never read back. `models` and `test` name a saved provider; the control plane uses its stored key. */
export function createAiProvider(request: Request) {
  const send = <T>(path: string, method: string, body: object) => request<T>(`${ROOT}${path}`, { method, body })
  return {
    current: () => request<AiProviderCurrent>(ROOT),
    presets: () => request<AiProviderPresetList>(`${ROOT}/presets`),
    models: (provider: string) => send<AiProviderModels>('/models', 'POST', { provider }),
    test: (provider: string, model: string) => send<AiProviderTestResult>('/test', 'POST', { provider, model }),
    save: (body: AiProviderSave) => send<AiProviderCurrent>('', 'PATCH', body),
  }
}

export function useAiProvider() {
  return createAiProvider(useVendorApi().request)
}
