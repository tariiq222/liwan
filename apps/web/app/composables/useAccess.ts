import { computed } from 'vue'
import { canReach } from '@/utils/accessPolicy'

export function useAccess() {
  const { me } = useMe()
  const capabilities = computed(() => (me.value as { capabilities?: string[] } | null)?.capabilities ?? [])
  const can = (capability: string) => canReach(me.value, capability)
  return { can, capabilities }
}
