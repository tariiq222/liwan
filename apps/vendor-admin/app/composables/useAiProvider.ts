import type { AiProviderCurrent, AiProviderModels, AiProviderPresetList, AiProviderTestResult } from '@liwan/commercial-contracts'
import type { ModelsFields, ProbeFields, SaveFields } from '../utils/aiProvider'

type Request = <T>(path: string, options?: { method?: string, body?: unknown }) => Promise<T>

const ROOT = 'platform/ai-provider'

/** The platform AI provider calls. The key is only ever sent, never read back; the body carries only the fields the form filled. */
export function createAiProvider(request: Request) {
  const send = <T>(path: string, method: string, body: object) => request<T>(`${ROOT}${path}`, { method, body })
  return {
    current: () => request<AiProviderCurrent>(ROOT),
    presets: () => request<AiProviderPresetList>(`${ROOT}/presets`),
    models: (fields: ModelsFields) => send<AiProviderModels>('/models', 'POST', fields),
    test: (fields: ProbeFields & { model: string }) => send<AiProviderTestResult>('/test', 'POST', fields),
    save: (fields: SaveFields) => send<AiProviderCurrent>('', 'PATCH', fields),
  }
}

export function useAiProvider() {
  return createAiProvider(useVendorApi().request)
}
