// The personal-tasks cache namespace (/api/v1/my-tasks). List rows are a different shape from the
// detail, so a write replaces `detail(id)` with the server response and invalidates `list` only.
export const myTaskKeys = {
  all: ['my-tasks'] as const,
  lists: ['my-tasks', 'list'] as const,
  list: (params: Record<string, unknown>) => ['my-tasks', 'list', params] as const,
  summary: (params: Record<string, unknown>) => ['my-tasks', 'summary', params] as const,
  summaries: ['my-tasks', 'summary'] as const,
  detail: (id: number | null) => ['my-tasks', 'detail', id] as const,
  comments: (id: number | null) => ['my-tasks', 'comments', id] as const,
  attachments: (id: number | null) => ['my-tasks', 'attachments', id] as const,
  convertTargets: (q: string) => ['my-tasks', 'convert-targets', q] as const,
}
