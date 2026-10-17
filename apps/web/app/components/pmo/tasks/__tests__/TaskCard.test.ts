import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../TaskCard.vue'), 'utf8')

describe('TaskCard list counts', () => {
  it('reads the subtask and attachment counts of the list payload', () => {
    expect(source).toContain('subtask_count')
    expect(source).toContain('subtask_done_count')
    expect(source).toContain('task.attachment_count > 0')
    expect(source).not.toMatch(/task\.subtasks|task\.attachments/)
  })

  it('shows the progress row only when there are subtasks', () => {
    expect(source).toContain('if (total <= 0) return null')
    expect(source).toContain('h-[5px]')
    expect(source).toContain('i-lucide-paperclip')
  })
})
