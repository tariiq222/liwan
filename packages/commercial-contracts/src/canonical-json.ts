/** Deterministic JSON for digests and signatures: object keys sorted, `undefined` properties omitted.
 * It imports nothing, so plain Node (type stripping, no bundler) can load it through the `./canonical-json` export,
 * which is how the control plane's shared provisioning code reaches it from the isolation acceptance harness. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).filter(k => obj[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}
