import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSessionKeys } from './guard.mjs'

const marker = 'SECRET-MARKER-0123456789'

test('a JSON map of key id to secret is returned as is', () => {
  const keys = { k1: 'a'.repeat(32), k2: 'b'.repeat(40) }
  assert.deepEqual(parseSessionKeys(JSON.stringify(keys)), keys)
})
for (const [name, raw] of [
  ['malformed JSON', `{"k1":"${marker}`],
  ['a bare string', JSON.stringify(marker)],
  ['an array', JSON.stringify([marker])],
  ['null', 'null'],
  ['an unset variable', undefined],
  ['an empty value', ''],
]) {
  test(`${name} fails with a fixed message that names the variable and never carries the value`, () => {
    assert.throws(() => parseSessionKeys(raw), error => {
      assert.match(error.message, /LIWAN_SESSION_KEYS/)
      assert.match(error.message, /JSON object/)
      assert.doesNotMatch(`${error.message}\n${error.stack}`, new RegExp(marker))
      assert.equal(error.cause, undefined)
      return true
    })
  })
}
