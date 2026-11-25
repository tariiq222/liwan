/** Rows per page of the staff bookings list. */
export const APPOINTMENT_PAGE_SIZE = 25

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
