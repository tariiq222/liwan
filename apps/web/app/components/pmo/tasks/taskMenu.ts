import type { DropdownMenuItem } from '@nuxt/ui'
import type { TaskDetail } from '@liwan/contracts'

export interface TaskMenuStage { id: number; name: string }

interface TaskMenuInput {
  task: Pick<TaskDetail, 'can_write' | 'personal_stage' | 'allowed_actions'>
  stages: TaskMenuStage[]
  t: (key: string) => string
  disabled: boolean
  copyLink: () => void
  setStage: (stage: TaskMenuStage | null) => void
  archive: () => void
}

// The ⋯ menu of the task record: copy the link, the reader's personal stage (a submenu, only when the task is
// writable), and archive (only when the server allows it). Groups are separated by a hairline.
export function taskMenuItems({ task, stages, t, disabled, copyLink, setStage, archive }: TaskMenuInput): DropdownMenuItem[][] {
  const groups: DropdownMenuItem[][] = [[{ label: t('tasks.detail.copyLink'), icon: 'i-lucide-link', onSelect: copyLink }]]
  if (task.can_write) {
    const current = task.personal_stage?.id ?? null
    groups[0]!.push({
      label: t('tasks.drawer.stage'),
      icon: 'i-lucide-columns-3',
      disabled,
      children: [[
        { label: t('tasks.drawer.unassigned'), icon: current === null ? 'i-lucide-check' : undefined, onSelect: () => setStage(null) },
        ...stages.map(stage => ({ label: stage.name, icon: current === stage.id ? 'i-lucide-check' : undefined, onSelect: () => setStage(stage) })),
      ]],
    })
  }
  if (task.allowed_actions.includes('archive')) {
    groups.push([{ label: t('tasks.drawer.archive'), icon: 'i-lucide-archive', color: 'error', disabled, onSelect: archive }])
  }
  return groups
}
