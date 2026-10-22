import { describe, expect, it } from 'vitest'
import { parseAiContext } from '../aiContext'

describe('parseAiContext', () => {
  it('reads a page and an optional record id', () => {
    expect(parseAiContext('project:12')).toEqual({ page: 'project', id: 12 })
    expect(parseAiContext('finance')).toEqual({ page: 'finance', id: null })
  })

  it('treats anything else as no context', () => {
    for (const raw of [undefined, null, '', 'Project:1', 'project:x', 'a:1:2', ['project:1'], 12]) expect(parseAiContext(raw)).toBeNull()
  })
})
