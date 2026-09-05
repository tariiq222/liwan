import { computed } from 'vue'
import { hasCapability } from '@/utils/accessPolicy'

export function useAccess() {
  const { me } = useMe()
  const capabilities = computed(() => (me.value as { capabilities?: string[] } | null)?.capabilities ?? [])
  const can = (capability: string) => hasCapability({ capabilities: capabilities.value }, capability)
  return { can, capabilities }
}
