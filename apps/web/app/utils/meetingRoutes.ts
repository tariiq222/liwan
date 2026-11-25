export function meetingCreateRoute(returnTo: string, projectId?: number | string, seriesId?: number | string) {
  return {
    path: '/meetings/new',
    query: {
      ...(projectId !== undefined && projectId !== null && String(projectId) ? { project_id: String(projectId) } : {}),
      ...(seriesId !== undefined && seriesId !== null && String(seriesId) ? { series_id: String(seriesId) } : {}),
      returnTo,
    },
  }
}

/** Same-origin download of the current minutes; the backend answers with an attachment. */
export function meetingMinutesPdfPath(meetingId: number) {
  return `/api/v1/meetings/${meetingId}/minutes.pdf`
}
