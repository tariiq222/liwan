import { BlockList, isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

/** The endpoint cannot be sent a provider key: wrong shape, or an address the control plane must never connect to. */
export class EndpointError extends Error {}

export type Resolver = (host: string) => Promise<string[]>
export const systemResolver: Resolver = async host => (await lookup(host, { all: true, verbatim: true })).map(entry => entry.address)

/** `allowPrivate`: the self-hosted Ollama preset, the only provider that may sit on a private or loopback address (and over plain http). */
export type EndpointPolicy = { allowPrivate: boolean }

const list = (v4: readonly string[], v6: readonly string[]): BlockList => {
  const blocks = new BlockList()
  for (const cidr of v4) { const [net, bits] = cidr.split('/'); blocks.addSubnet(net!, Number(bits), 'ipv4') }
  for (const cidr of v6) { const [net, bits] = cidr.split('/'); blocks.addSubnet(net!, Number(bits), 'ipv6') }
  return blocks
}

/** Never connected to, whatever the preset: unspecified, link-local (cloud metadata), multicast, reserved, broadcast, and the cloud metadata addresses that sit in private ranges. */
const FORBIDDEN = list(
  ['0.0.0.0/8', '169.254.0.0/16', '100.100.100.200/32', '192.0.0.0/24', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4'],
  ['::/128', 'fe80::/10', 'ff00::/8', 'fd00:ec2::/32', '2001::/32' /* Teredo */, '100::/64' /* discard-only */],
)
/** Private ranges: loopback, RFC 1918, carrier-grade NAT, unique-local. Only the Ollama preset may reach them. */
const PRIVATE = list(['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10'], ['::1/128', 'fc00::/7'])

/** The eight 16-bit groups of an IPv6 address (`::` and a trailing dotted quad expanded), or null when it is not one. */
function groups(address: string): number[] | null {
  let text = address.split('%')[0]!
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (dotted) {
    const octets = dotted[1]!.split('.').map(Number)
    if (octets.some(octet => octet > 255)) return null
    text = `${text.slice(0, -dotted[1]!.length)}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`
  }
  const [head, tail, extra] = text.split('::')
  if (extra !== undefined) return null
  const parse = (part: string | undefined) => (part ? part.split(':').map(group => Number.parseInt(group, 16)) : [])
  const first = parse(head)
  const last = parse(tail)
  const missing = 8 - first.length - last.length
  if ((tail === undefined && missing !== 0) || missing < 0 || [...first, ...last].some(group => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null
  return [...first, ...Array<number>(tail === undefined ? 0 : missing).fill(0), ...last]
}

const v4Of = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`

/** The IPv4 address an IPv6 one carries (mapped `::ffff:a.b.c.d`, compatible `::a.b.c.d`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`), or null. */
function embeddedV4(parts: number[]): string | null {
  const [a, b, c, d, e, f, g, h] = parts as [number, number, number, number, number, number, number, number]
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0xffff || (f === 0 && (g !== 0 || h > 1)))) return v4Of(g, h)
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return v4Of(g, h)
  if (a === 0x2002) return v4Of(b, c)
  return null
}

/** `forbidden` is never reachable, `private` only for the Ollama preset, `public` for every preset. IPv4 carried inside an IPv6 address is judged as that IPv4 address. */
export function addressClass(address: string): 'public' | 'private' | 'forbidden' {
  const text = address.replace(/^\[|\]$/g, '')
  const family = isIP(text.split('%')[0]!)
  if (family === 4) return FORBIDDEN.check(text, 'ipv4') ? 'forbidden' : PRIVATE.check(text, 'ipv4') ? 'private' : 'public'
  const parts = family === 6 ? groups(text) : null
  if (!parts) return 'forbidden'  // not an address at all: never trusted
  const embedded = embeddedV4(parts)
  if (embedded) return addressClass(embedded)
  const canonical = parts.map(group => group.toString(16)).join(':')
  return FORBIDDEN.check(canonical, 'ipv6') ? 'forbidden' : PRIVATE.check(canonical, 'ipv6') ? 'private' : 'public'
}

export const addressAllowed = (address: string, policy: EndpointPolicy): boolean => {
  const kind = addressClass(address)
  return kind === 'public' || (kind === 'private' && policy.allowPrivate)
}

const METADATA_NAMES = new Set(['metadata', 'metadata.google.internal', 'metadata.goog', 'instance-data', 'instance-data.ec2.internal', 'kubernetes.default', 'kubernetes.default.svc'])
const isPrivateName = (host: string): boolean => !host.includes('.') || host === 'localhost' || ['.localhost', '.local', '.internal', '.lan', '.home.arpa'].some(suffix => host.endsWith(suffix))

/**
 * The endpoint the control plane will send a key to, checked by shape and by name: https (plain http only for the Ollama
 * preset), no credentials, query or fragment, no IP literal or well-known name that is a loopback, private, link-local or
 * metadata address. Trailing slashes are dropped. A name that merely resolves to such an address is caught where the
 * connection is made (guarded-fetch.ts), because only there a rebinding answer cannot slip through.
 */
export function cleanEndpoint(value: string, policy: EndpointPolicy): string {
  let url: URL
  try { url = new URL(value) } catch { throw new EndpointError('base_url') }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  const schemeOk = url.protocol === 'https:' || (policy.allowPrivate && url.protocol === 'http:')
  if (!schemeOk || url.username || url.password || url.search || url.hash || !host) throw new EndpointError('base_url')
  if (isIP(host)) { if (!addressAllowed(host, policy)) throw new EndpointError('base_url') }
  else if (METADATA_NAMES.has(host) || (!policy.allowPrivate && isPrivateName(host))) throw new EndpointError('base_url')
  return url.toString().replace(/\/+$/, '')
}

/** `cleanEndpoint`, and for a name also what it resolves to now (an early, readable refusal; the connection checks again). A name that does not resolve is left to the connection. */
export async function checkEndpoint(value: string, policy: EndpointPolicy, resolve: Resolver = systemResolver): Promise<string> {
  const endpoint = cleanEndpoint(value, policy)
  const host = new URL(endpoint).hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return endpoint
  let addresses: string[] = []
  try { addresses = await resolve(host) } catch { return endpoint }
  if (addresses.some(address => !addressAllowed(address, policy))) throw new EndpointError('base_url')
  return endpoint
}
