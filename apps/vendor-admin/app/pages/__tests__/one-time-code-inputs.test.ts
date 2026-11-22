import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// A pasted "123 456" is seven characters: the field must hold it so the code is read after the spaces are dropped.
describe.each(['login.vue', 'enroll.vue'])('the one-time code field of %s', file => {
  const source = readFileSync(resolve(import.meta.dirname, '..', file), 'utf8')
  it('does not truncate a pasted code to six characters', () => {
    const field = /<UInput id="totp-code"[^>]*>/.exec(source)![0]
    expect(field).not.toContain('maxlength="6"')
  })
})
