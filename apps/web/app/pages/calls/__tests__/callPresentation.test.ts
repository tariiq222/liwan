import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { callDuration, callNumber, callParty, callTime } from '../../../components/telephony/callPresentation'
import { owningListBack } from '../../../utils/recordListOrigin'

// The two call pages read the same helpers for what a call shows and where it goes back to; the pages themselves are
// guarded on the few lines the reader depends on. The test lives under app/pages/calls/__tests__; read from the web root.
const web = resolve(import.meta.dirname, '../../../..')
const read = (path: string) => readFileSync(resolve(web, path), 'utf8')
const LISTS = ['/calls'] as const
const LRI = '\u2066'
const PDI = '\u2069'

describe('a call moment in the reader\'s time zone', () => {
  it('shows the instant in the reader\'s zone, not as the server stored it', () => {
    expect(callTime('2026-11-27T15:04:05Z', 'Asia/Riyadh')).toBe(`${LRI}27/11/2026 18:04${PDI}`)
    expect(callTime('2026-11-27T15:04:05Z', 'America/New_York')).toBe(`${LRI}27/11/2026 10:04${PDI}`)
    // East of the date line the same instant is already the next day.
    expect(callTime('2026-11-27T15:04:05Z', 'Pacific/Auckland')).toBe(`${LRI}28/11/2026 04:04${PDI}`)
  })

  it('reads the microseconds pbx-agent stamps and falls back to the platform zone', () => {
    expect(callTime('2026-11-27T15:04:05.123456Z', 'Asia/Riyadh')).toBe(`${LRI}27/11/2026 18:04${PDI}`)
    expect(callTime('2026-11-27T15:04:05Z', undefined)).toBe(`${LRI}27/11/2026 18:04${PDI}`)
  })

  it('has nothing to show for a moment that has not come', () => {
    expect(callTime(null, 'Asia/Riyadh')).toBeNull()
    expect(callTime('', 'Asia/Riyadh')).toBeNull()
  })
})

describe('who a call was with', () => {
  const customer = { partner: { id: 4, name: 'شركة النور' }, remoteNumber: '+966501234567', extension: { id: 1, name: '1001' } }
  const stranger = { partner: null, remoteNumber: '+966501234567', extension: { id: 1, name: '1001' } }
  const internal = { partner: null, remoteNumber: null, extension: { id: 2, name: '1002' } }

  it('names the customer when the call is linked to one, else the number, else the extension', () => {
    expect(callParty(customer)).toBe('شركة النور')
    expect(callParty(stranger)).toBe('+966501234567')
    expect(callParty(internal)).toBe('1002')
    expect(callParty({ partner: null, remoteNumber: null, extension: null })).toBe('')
  })

  it('keeps the number under a customer\'s name, and never prints the extension object', () => {
    expect(callNumber(customer)).toBe('+966501234567')
    expect(callNumber(internal)).toBe('1002')
    expect(callNumber({ partner: null, remoteNumber: null, extension: null })).toBeNull()
  })
})

describe('how long a call lasted', () => {
  it('is m:ss once the call ended, and nothing before', () => {
    expect(callDuration(null)).toBeNull()
    expect(callDuration(0)).toBeNull()
    expect(callDuration(5)).toBe('0:05')
    expect(callDuration(65)).toBe('1:05')
    expect(callDuration(3600)).toBe('60:00')
  })
})

describe('the call page\'s back link', () => {
  it('returns to the list it was opened from, with its filters and its page', () => {
    expect(owningListBack({ returnTo: '/calls?direction=in&state=missed&offset=25' }, LISTS)).toBe('/calls?direction=in&state=missed&offset=25')
    expect(owningListBack({}, LISTS, '#top')).toEqual({ path: '/calls', query: {}, hash: '#top' })
  })

  it.each([
    'https://evil.example/calls', '//evil.example/calls', '/\\evil.example/calls', '/customers?direction=in', '/calls/5', '/settings/apps/telephony',
  ])('returns to the whole log for %s', (returnTo) => {
    expect(owningListBack({ returnTo }, LISTS)).toEqual({ path: '/calls', query: {} })
  })
})

describe('the two call pages', () => {
  const list = read('app/pages/calls/index.vue')
  const detail = read('app/pages/calls/[id].vue')

  it('list: filters in the house bar, disabled until hydrated, and kept in the URL', () => {
    expect(list).toContain('<SharedFilterBar embedded')
    expect(list).toContain(':disabled="!hydrated"')
    expect(list).toContain("route.query.direction")
    expect(list).toContain("route.query.state")
    expect(list).toContain("route.query.offset")
  })

  it('list: times in the reader\'s zone, the number or the extension\'s name, never the raw UTC text or the object', () => {
    expect(list).toContain('callTime(row.original.startedAt, timeZone)')
    expect(list).toContain('callNumber(row.original)')
    expect(list).not.toContain(".replace('T', ' ')")
    expect(list).not.toContain('row.original.extension }}')
  })

  it('list: every row opens its call from this exact address', () => {
    expect(list).toContain('returnToQuery(route.fullPath)')
    expect(list).toContain(':row-to="row => callTo(row.id)"')
  })

  it('detail: goes back only through the owning list rule, for the back link and for Escape alike', () => {
    expect(detail).toContain('owningListBack(route.query, sourcePaths.value, route.hash)')
    expect(detail).toContain(':back-to="backTo"')
    expect(detail).not.toMatch(/back-to="'\/calls'/)
  })

  it('detail: shows the three moments, the party and the employee through the shared helpers', () => {
    expect(detail).toContain('callTime(data.startedAt, timeZone)')
    expect(detail).toContain('callTime(data.answeredAt, timeZone)')
    expect(detail).toContain('callTime(data.endedAt, timeZone)')
    expect(detail).toContain('callParty(data)')
    expect(detail).toContain('data.user?.name')
  })
})
