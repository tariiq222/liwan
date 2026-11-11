import { hasFeature } from '../../modules/registry'

/** Whether the tenant holds one Customer Messages sub-feature, so the screens that act on it are offered at all. */
export function useInboxFeature(feature: string) {
  const { me } = useMe()
  return computed(() => hasFeature(me.value, feature))
}

export const useInboxWhatsAppEnabled = () => useInboxFeature('inbox.whatsapp')
export const useInboxTemplatesEnabled = () => useInboxFeature('inbox.templates')
export const useInboxFlowsEnabled = () => useInboxFeature('inbox.flows')
export const useInboxAutomationEnabled = () => useInboxFeature('inbox.automation')
