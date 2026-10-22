import type { EffectiveCapability } from '@webvue/contracts'

type CapabilityGroup = { domain: string; items: EffectiveCapability[] }

/** Above this many capabilities a record opens its groups collapsed. */
export const CAPABILITY_GROUPS_OPEN_LIMIT = 12

/** Group effective capabilities by domain, in first-seen order. `domainOf` maps a capability key to its domain. */
export function groupCapabilities(capabilities: EffectiveCapability[], domainOf: (key: string) => string): CapabilityGroup[] {
  const groups = new Map<string, EffectiveCapability[]>()
  for (const capability of capabilities) {
    const domain = domainOf(capability.key)
    groups.set(domain, [...(groups.get(domain) ?? []), capability])
  }
  return [...groups].map(([domain, items]) => ({ domain, items }))
}
