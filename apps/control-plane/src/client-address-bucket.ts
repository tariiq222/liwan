import { isIP } from 'node:net'

const IPV6_GROUPS = 8
const IPV4_MAPPED_PREFIX_GROUPS = 5
const IPV4_MAPPED_MARKER = 0xffff
/** An IPv6 subscriber normally holds a whole /64, so a visitor must not get a fresh bucket by changing the low 64 bits. */
const IPV6_BUCKET_GROUPS = 4

/** The eight 16-bit groups of a valid IPv6 address (zone id and embedded dotted IPv4 tail handled). */
function ipv6Groups(address: string): number[] {
  let text = address.split('%')[0]!
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text)
  if (tail) {
    const [, a, b, c, d] = tail.map(Number)
    text = `${text.slice(0, tail.index)}${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`
  }
  const [head = '', rest] = text.split('::')
  const front = head ? head.split(':') : []
  const back = rest ? rest.split(':') : []
  const zeros = rest === undefined ? 0 : IPV6_GROUPS - front.length - back.length
  return [...front, ...Array<string>(zeros).fill('0'), ...back].map(group => parseInt(group, 16))
}

/** The rate-limit bucket of a client address: an IPv4 address as is, an IPv4-mapped IPv6 address as its IPv4 address,
 *  any other IPv6 address as its /64. Text that is not an address is returned unchanged. */
export function clientAddressBucket(address: string): string {
  if (isIP(address) !== 6) return address
  const groups = ipv6Groups(address)
  if (groups.slice(0, IPV4_MAPPED_PREFIX_GROUPS).every(group => group === 0) && groups[IPV4_MAPPED_PREFIX_GROUPS] === IPV4_MAPPED_MARKER)
    return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`
  return `${groups.slice(0, IPV6_BUCKET_GROUPS).map(group => group.toString(16)).join(':')}::/64`
}
