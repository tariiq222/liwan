import { normalizedPath } from './routePath'

/** The project pages whose primary action the workspace header draws: the summary, the task list and the meeting list. */
export type ProjectActionPage = 'summary' | 'tasks' | 'meetings'

/**
 * Which of those pages a path is. Records, forms and every other section (finance, governance, milestones) are none:
 * they keep their own action, and the header draws no primary button over them.
 */
export function projectActionPage(path: string): ProjectActionPage | null {
  const match = normalizedPath(path).match(/^\/projects\/[1-9]\d*(?:\/(tasks|meetings))?$/)
  if (!match) return null
  return (match[1] as ProjectActionPage | undefined) ?? 'summary'
}
