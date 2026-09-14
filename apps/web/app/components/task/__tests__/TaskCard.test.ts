import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// ClickUp-style board card: hairline surface, priority rail, quiet menu that
// surfaces on hover/focus, one meta row.
const src = readFileSync(resolve(import.meta.dirname, '../TaskCard.vue'), 'utf8')

describe('task card design', () => {
  it('is a hairline record surface with a priority rail, not an elevated UCard', () => {
    expect(src).not.toContain('<UCard')
    expect(src).toContain('nasq-ui-record-surface nasq-ui-task-card')
    expect(src).toContain(':data-priority="task.priority"')
    expect(src).toContain('data-row')
  })

  it('keeps the move menu inside the hover-revealed row actions', () => {
    expect(src).toMatch(/class="nasq-ui-row-actions[^"]*"[\s\S]*?<UDropdownMenu/)
    expect(src).toMatch(/<UDropdownMenu[\s\S]*?variant="ghost"/)
  })

  it('keeps the board test ids and open/move contract', () => {
    expect(src).toContain(':data-testid="`board-card-${task.id}`"')
    expect(src).toContain(':data-readonly="!task.can_write"')
    expect(src).toContain("emit('open', props.task.id)")
    expect(src).toContain("emit('move', stage)")
  })
})
