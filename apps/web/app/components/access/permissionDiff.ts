import type { EffectiveCapability } from '@nasq/contracts'

export type PermissionDiff = {
  added: EffectiveCapability[]
  removed: EffectiveCapability[]
  retained: EffectiveCapability[]
}

/** Compare effective capabilities while retaining the server-provided sources. */
export function permissionDiff(before: EffectiveCapability[], after: EffectiveCapability[]): PermissionDiff {
  const beforeByKey = new Map(before.map((capability) => [capability.key, capability]))
  const afterByKey = new Map(after.map((capability) => [capability.key, capability]))
  return {
    added: after.filter((capability) => !beforeByKey.has(capability.key)),
    removed: before.filter((capability) => !afterByKey.has(capability.key)),
    retained: after.filter((capability) => beforeByKey.has(capability.key)),
  }
}
