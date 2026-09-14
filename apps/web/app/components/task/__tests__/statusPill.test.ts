import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRIORITY_TONE, accessTone, deadlineTone, stateToneToPill } from '../../../utils/statusTone'

// Every status badge renders the one shared pill recipe with a fixed semantic
// tone, so ClickUp-style colour is consistent across tasks, projects and access.
const appRoot = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(appRoot, path), 'utf8')

describe('status pill badges', () => {
  it.each([
    ['components/task/StateBadge.vue', ':data-tone="tone"'],
    ['components/project/ProjectStatusBadge.vue', ':data-tone="tone"'],
    ['components/task/DeadlineBadge.vue', ':data-tone="tone"'],
    ['components/access/AccessStateBadge.vue', ':data-tone="tone"'],
    ['components/hr/AccessBadge.vue', ':data-tone="tone"'],
  ])('%s renders the shared pill', (path, binding) => {
    const src = read(path)
    expect(src).toContain('class="nasq-ui-status-pill"')
    expect(src).toContain(binding)
    expect(src).not.toContain('<UBadge')
  })

  it('keeps the test ids callers and e2e rely on', () => {
    expect(read('components/project/ProjectStatusBadge.vue')).toContain('data-testid="project-status"')
    expect(read('components/task/DeadlineBadge.vue')).toContain('data-testid="deadline-badge"')
    expect(read('components/hr/AccessBadge.vue')).toContain('data-testid="hr-access-badge"')
  })

  it('read-only priority shows the priority pill', () => {
    expect(read('components/task/PrioritySelect.vue')).toContain('PRIORITY_TONE[task.priority]')
  })
})

describe('tone helpers', () => {
  it('maps deadlines: closed or unknown → neutral, past → overdue, ≤2 days → soon', () => {
    expect(deadlineTone(-3, false)).toBe('overdue')
    expect(deadlineTone(0, false)).toBe('soon')
    expect(deadlineTone(2, false)).toBe('soon')
    expect(deadlineTone(3, false)).toBe('neutral')
    expect(deadlineTone(-3, true)).toBe('neutral')
    expect(deadlineTone(null, false)).toBe('neutral')
  })

  it('maps priorities 0..3 to low/normal/high/urgent', () => {
    expect(PRIORITY_TONE).toEqual({ '0': 'low', '1': 'normal', '2': 'high', '3': 'urgent' })
  })

  it('maps account access: active → granted, inactive → disabled, none → neutral', () => {
    expect(accessTone(true)).toBe('granted')
    expect(accessTone(false)).toBe('disabled')
    expect(accessTone(null)).toBe('neutral')
  })

  it('maps legacy StateTone overrides onto pill tones', () => {
    expect(stateToneToPill('success')).toBe('done')
    expect(stateToneToPill('destructive')).toBe('cancelled')
    expect(stateToneToPill('info')).toBe('in_progress')
  })
})
