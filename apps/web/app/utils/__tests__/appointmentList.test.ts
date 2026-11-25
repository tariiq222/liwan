import { describe, expect, it } from 'vitest'
import { APPOINTMENT_PAGE_SIZE, appointmentListQuery, lastAppointmentPageOffset } from '../appointmentList'

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

describe('lastAppointmentPageOffset', () => {
  it('lands a past-the-end offset on the last page that still has rows', () => {
    expect(APPOINTMENT_PAGE_SIZE).toBe(25)
    expect(lastAppointmentPageOffset(0)).toBe(0)
    expect(lastAppointmentPageOffset(25)).toBe(0)
    expect(lastAppointmentPageOffset(26)).toBe(25)
    expect(lastAppointmentPageOffset(50)).toBe(25)
    expect(lastAppointmentPageOffset(51)).toBe(50)
  })
})
