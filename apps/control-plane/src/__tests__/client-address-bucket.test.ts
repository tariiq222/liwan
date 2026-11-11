import { expect, it } from 'vitest'
import { clientAddressBucket } from '../client-address-bucket.js'

it('keeps an IPv4 address as is', () => {
  expect(clientAddressBucket('203.0.113.7')).toBe('203.0.113.7')
})
it('buckets an IPv6 address by its /64, however it is written', () => {
  const bucket = '2001:db8:1:2::/64'
  expect(clientAddressBucket('2001:db8:1:2::1')).toBe(bucket)
  expect(clientAddressBucket('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe(bucket)
  expect(clientAddressBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(bucket)
  expect(clientAddressBucket('2001:db8:1:3::1')).not.toBe(bucket)
  expect(clientAddressBucket('::1')).toBe('0:0:0:0::/64')
  expect(clientAddressBucket('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
})
it('unmaps an IPv4-mapped IPv6 address to its IPv4 address', () => {
  expect(clientAddressBucket('::ffff:203.0.113.7')).toBe('203.0.113.7')
  expect(clientAddressBucket('::ffff:cb00:7107')).toBe('203.0.113.7')
  expect(clientAddressBucket('0:0:0:0:0:ffff:192.0.2.33')).toBe('192.0.2.33')
})
it('returns text that is not an address unchanged', () => {
  for (const text of ['unknown', '', '1.2.3', '2001:db8::zz', '::ffff:999.1.1.1']) expect(clientAddressBucket(text)).toBe(text)
})
