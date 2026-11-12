import { computed } from 'vue'
import { canReach, personalIdentity } from '@/utils/accessPolicy'

export function useAccess() {
  const { me } = useMe()
  const capabilities = computed(() => (me.value as { capabilities?: string[] } | null)?.capabilities ?? [])
  const can = (capability: string) => canReach(me.value, capability)
  // The personal pages are served from the home company: their own checks follow the capabilities held there.
  const canPersonal = (capability: string) => canReach(personalIdentity(me.value), capability)
  return { can, canPersonal, capabilities }
}
