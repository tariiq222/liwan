import { describe, expect, it, vi } from 'vitest'
import { createCopyLink } from '../useCopyLink'

describe('copy link', () => {
  it('reports success only for the link that was copied', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const copy = createCopyLink(write)
    await copy.copy('https://a.test/enroll#one')
    expect(write).toHaveBeenCalledWith('https://a.test/enroll#one')
    expect(copy.outcomeFor('https://a.test/enroll#one')).toBe('copied')
    expect(copy.outcomeFor('https://a.test/enroll#two')).toBeNull()
  })

  it('reports a failed copy and forgets it for another link', async () => {
    const copy = createCopyLink(vi.fn().mockRejectedValue(new Error('denied')))
    await copy.copy('x')
    expect(copy.outcomeFor('x')).toBe('failed')
    expect(copy.outcomeFor('y')).toBeNull()
  })
})
