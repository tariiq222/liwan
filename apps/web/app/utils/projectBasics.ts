import type { ProjectObjectiveWrite } from '@liwan/contracts'

/** The same core fields back manual creation, project editing and AI drafts. */
export interface ProjectBasicsDraft {
  name: string
  description: string
  objectives: ProjectObjectiveWrite[]
  success_criteria: string
  user_id: number | null
  date_start: string | null
  date_end: string | null
}
