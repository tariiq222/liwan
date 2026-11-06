/** Starter questions of an empty conversation; each key is under `ai.starters.*`. Only questions the registered assistant tools can answer (projects and tasks) belong here. */
export const AI_STARTER_KEYS = ['overdue', 'projects', 'week'] as const

/** Starter questions of an empty help conversation; each key is under `ai.helpStarters.*` and is answered by a section of the user guide. */
export const AI_HELP_STARTER_KEYS = ['employee', 'project', 'role'] as const

const GENERIC_FOLLOW_UPS = ['summary', 'next', 'risks'] as const
const FOLLOW_UPS_BY_PAGE: Record<string, readonly string[]> = {
  project: ['projectRisks', 'projectTasks', 'projectNext'],
  task: ['taskBlockers', 'taskNext', 'taskRelated'],
  finance: ['financeOverdue', 'financeCash', 'financeNext'],
}

/** Rail module ids the sheet sends when there is no record in the path, and the record kind whose follow-ups they use. */
const PAGE_ALIASES: Record<string, string> = { projects: 'project', tasks: 'task' }

/** The follow-up question keys (under `ai.followUps.*`) for the page the user came from, or the generic ones. */
export function followUpKeys(page: string | null): readonly string[] {
  const key = page === null ? null : Object.hasOwn(PAGE_ALIASES, page) ? PAGE_ALIASES[page]! : page
  return key && Object.hasOwn(FOLLOW_UPS_BY_PAGE, key) ? FOLLOW_UPS_BY_PAGE[key]! : GENERIC_FOLLOW_UPS
}
