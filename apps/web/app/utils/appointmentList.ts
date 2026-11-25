/** Rows per page of the staff bookings list. */
export const APPOINTMENT_PAGE_SIZE = 25

/** The offset of the last page that still has rows (0 for an empty list): where a past-the-end offset lands. */
export function lastAppointmentPageOffset(total: number): number {
  return Math.max(0, Math.ceil(total / APPOINTMENT_PAGE_SIZE) - 1) * APPOINTMENT_PAGE_SIZE
}

/**
 * The next URL query after a filter change: unrelated keys stay, a cleared value leaves the URL, and the list returns
 * to its first page unless the change pages itself (an offset from the old filter would land on an empty page).
 */
export function appointmentListQuery(
  query: Record<string, unknown>,
  patch: Record<string, string | null | undefined>,
  resetOffset = true,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...query }
  if (resetOffset && !('offset' in patch)) delete next.offset
  for (const [key, value] of Object.entries(patch)) {
    if (value) next[key] = value
    else delete next[key]
  }
  return next
}
