import type { Task, TaskPatch } from '@liwan/contracts'
import type { Resolved } from './useTasks'

// A board column source. مهامي groups by the user's personal stages
// (personal_stage_type_id); a project groups by the project's own stages
// (stage_id). Everything the board does differently between the two lives here.
export interface BoardStage { id: number; name: string; sequence: number; fold: boolean }
export type StageSource = { kind: 'personal' } | { kind: 'project'; stages: BoardStage[] }

export function stageOf(task: Task, kind: StageSource['kind']): Task['stage'] {
  return kind === 'personal' ? task.personal_stage : task.stage
}

// The PATCH (and the display object for the optimistic cache update) that moves
// a task into `stage`. `null` stage = the "no stage" column, which only a
// personal board allows: a project task always has a project stage.
export function moveTo(kind: StageSource['kind'], stage: BoardStage | null): { patch: TaskPatch; resolved: Resolved } | null {
  const ref = stage ? { id: stage.id, name: stage.name } : null
  if (kind === 'personal') return { patch: { personal_stage_type_id: stage?.id ?? null }, resolved: { personal_stage: ref } }
  if (!stage) return null
  return { patch: { stage_id: stage.id }, resolved: { stage: ref } }
}
