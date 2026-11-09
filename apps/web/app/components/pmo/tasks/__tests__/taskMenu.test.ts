import { describe, expect, it, vi } from 'vitest'
import { taskMenuItems } from '../taskMenu'

const t = (key: string) => key
const stages = [{ id: 1, name: 'Backlog' }, { id: 2, name: 'Doing' }]
function menu(overrides: Partial<Parameters<typeof taskMenuItems>[0]['task']> = {}, disabled = false) {
  const calls = { copy: vi.fn(), stage: vi.fn(), archive: vi.fn() }
  const groups = taskMenuItems({
    task: { can_write: true, personal_stage: null, allowed_actions: ['read', 'write', 'archive'], ...overrides },
    stages, t, disabled, copyLink: calls.copy, setStage: calls.stage, archive: calls.archive,
  })
  return { groups, calls }
}
const labels = (groups: ReturnType<typeof menu>['groups']) => groups.map(group => group.map(item => item.label))

describe('the task ⋯ menu', () => {
  it('offers copy link, personal stage and archive, with archive in its own group', () => {
    expect(labels(menu().groups)).toEqual([['tasks.detail.copyLink', 'tasks.drawer.stage'], ['tasks.drawer.archive']])
  })

  it('hides the personal stage when the task is read-only and archive when the server does not allow it', () => {
    expect(labels(menu({ can_write: false, allowed_actions: ['read'] }).groups)).toEqual([['tasks.detail.copyLink']])
  })

  it('lists the stages with the current one checked, and picks one or none', () => {
    const { groups, calls } = menu({ personal_stage: { id: 2, name: 'Doing' } })
    const stage = groups[0]![1]!
    const options = (stage.children as Array<Array<{ label: string; icon?: string; onSelect: () => void }>>)[0]!
    expect(options.map(option => [option.label, option.icon])).toEqual([['tasks.drawer.unassigned', undefined], ['Backlog', undefined], ['Doing', 'i-lucide-check']])
    options[1]!.onSelect()
    options[0]!.onSelect()
    expect(calls.stage.mock.calls).toEqual([[stages[0]], [null]])
  })

  it('runs copy and archive, and disables the stage and archive items while busy', () => {
    const { groups, calls } = menu({}, true)
    groups[0]![0]!.onSelect!(new Event('select'))
    groups[1]![0]!.onSelect!(new Event('select'))
    expect(calls.copy).toHaveBeenCalledOnce()
    expect(calls.archive).toHaveBeenCalledOnce()
    expect(groups[0]![1]!.disabled).toBe(true)
    expect(groups[1]![0]!.disabled).toBe(true)
  })
})
