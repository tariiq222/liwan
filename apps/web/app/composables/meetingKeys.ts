// The meetings cache namespace, kept free of schemas and vue-query like
// `projectKeys` and `taskKeys`. Two roots: meetings and meeting series. Every
// meeting read and invalidation goes through these builders so a write can
// refresh both roots without hand-rolled key literals.
export const meetingKeys = {
  all: ['meetings'] as const,
  list: (params: Record<string, unknown>) => ['meetings', params] as const,
  detail: (id: number | null) => ['meetings', id] as const,
  attachments: (id: number | null) => ['meetings', 'attachments', id] as const,
  events: (id: number | null, params: Record<string, unknown>) => ['meetings', id, 'events', params] as const,
  versions: (id: number | null, params: Record<string, unknown>) => ['meetings', id, 'versions', params] as const,
  version: (id: number | null, versionId: number | null) => ['meetings', id, 'versions', versionId] as const,
}

export const meetingSeriesKeys = {
  all: ['meeting-series'] as const,
  list: (params: Record<string, unknown>) => ['meeting-series', params] as const,
  detail: (id: number | null) => ['meeting-series', id] as const,
  events: (id: number | null, params: Record<string, unknown>) => ['meeting-series', id, 'events', params] as const,
  resolutions: (id: number | null, params: Record<string, unknown>) => ['meeting-series', id, 'resolutions', params] as const,
}

interface MeetingCacheClient {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown
}

/** Refresh every meeting and series view after a write. */
export function invalidateMeetingCaches(qc: MeetingCacheClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: meetingKeys.all }),
    qc.invalidateQueries({ queryKey: meetingSeriesKeys.all }),
  ])
}
