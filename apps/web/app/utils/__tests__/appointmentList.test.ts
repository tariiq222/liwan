import { describe, expect, it } from 'vitest'
import { appointmentListQuery } from '../appointmentList'

describe('appointmentListQuery', () => {
  it('returns the list to its first page when the day or a filter changes', () => {
    expect(appointmentListQuery({ day: '2026-11-24', offset: '50', state: 'confirmed' }, { day: '2026-11-25' }))
      .toEqual({ day: '2026-11-25', state: 'confirmed' })
    expect(appointmentListQuery({ day: '2026-11-25', offset: '25' }, { state: 'pending' }))
      .toEqual({ day: '2026-11-25', state: 'pending' })
    expect(appointmentListQuery({ day: '2026-11-25', offset: '25', type_id: '3' }, { type_id: undefined }))
      .toEqual({ day: '2026-11-25' })
  })

  it('keeps the chosen page while the pager itself writes the offset', () => {
    expect(appointmentListQuery({ day: '2026-11-25', offset: '25' }, { offset: '50' }, false))
      .toEqual({ day: '2026-11-25', offset: '50' })
    expect(appointmentListQuery({ day: '2026-11-25', offset: '25' }, { offset: undefined }, false))
      .toEqual({ day: '2026-11-25' })
  })
})
