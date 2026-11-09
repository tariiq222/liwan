// A record of a project (a task, milestone, meeting or update opened inside the project) draws its own header and
// trail with `SharedRecordWorkspace`, so the project frame stays out of its way: no tabs, no phase stepper, no
// identity row. Only the record itself counts: a list, a `/new` form and a record's `/edit` form keep the frame.
const RECORD = /^\/projects\/\d+\/(?:tasks|milestones|meetings|updates)\/(?!new(?:\/|$))[^/]+\/?$/

export function isProjectRecordPath(path: string): boolean {
  return RECORD.test(path)
}
