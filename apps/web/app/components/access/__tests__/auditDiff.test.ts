import { describe, expect, it } from 'vitest'
import { auditDiffLines } from '../auditDiff'

describe('auditDiffLines', () => {
  it('marks only the lines whose value differs on each side', () => {
    const diff = auditDiffLines({ active: true, name: 'a' }, { active: false, name: 'a' })
    expect(diff.before.filter((line) => line.changed).map((line) => line.text.trim())).toEqual(['"active": true,'])
    expect(diff.after.filter((line) => line.changed).map((line) => line.text.trim())).toEqual(['"active": false,'])
  })
  it('marks nothing when a side has no state', () => {
    const diff = auditDiffLines(null, { active: true })
    expect(diff.before).toEqual([{ text: 'null', changed: false }])
    expect(diff.after.every((line) => !line.changed)).toBe(true)
  })
})
