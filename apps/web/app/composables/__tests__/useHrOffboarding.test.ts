import { describe, expect, it } from 'vitest'
import { hrDepartureKeys, hrDepartureListQuery } from '../useHrOffboarding'

describe('hr offboarding departure queries', () => {
  it('trims the search and drops an unset filter', () => {
    expect(hrDepartureListQuery({ limit: 25, offset: 0 })).toEqual({
      q: undefined, cleared: undefined, limit: 25, offset: 0,
    })
    expect(hrDepartureListQuery({ q: '  نورة ', cleared: 'true', limit: 25, offset: 25 })).toEqual({
      q: 'نورة', cleared: 'true', limit: 25, offset: 25,
    })
  })

  it('keeps the departure keys scoped to the offboarding area', () => {
    expect(hrDepartureKeys.all).toEqual(['hr', 'offboarding'])
    expect(hrDepartureKeys.reasons).toEqual(['hr', 'offboarding', 'reasons'])
    expect(hrDepartureKeys.departure(10)).toEqual(['hr', 'offboarding', 'departure', 10])
    expect(hrDepartureKeys.departures({ limit: 25, offset: 0 }))
      .toEqual(['hr', 'offboarding', 'departures', { limit: 25, offset: 0 }])
  })
})
