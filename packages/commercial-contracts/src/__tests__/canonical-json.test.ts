import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../index'

// The one canonical form behind every digest and signature: sorted keys, no whitespace, `undefined` properties absent.
describe('canonicalJson', () => {
  it('sorts keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe('{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}')
  })
  it('keeps array order and nests arrays', () => {
    expect(canonicalJson([3, [2, 1], { b: [], a: {} }])).toBe('[3,[2,1],{"a":{},"b":[]}]')
  })
  it('leaves out an object property whose value is undefined, so it equals the same object without it', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(canonicalJson({ a: { c: undefined, d: 1 } })).toBe(canonicalJson({ a: { d: 1 } }))
    expect(canonicalJson({ a: null })).toBe('{"a":null}')
  })
  it('writes non-ASCII text and escapes exactly as JSON.stringify does', () => {
    expect(canonicalJson({ 'ä': 'ليوان', 'a"b': 'line\nbreak' })).toBe('{"a\\"b":"line\\nbreak","ä":"ليوان"}')
  })
  it('orders keys by UTF-16 code unit, not by locale', () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, _: 4 })).toBe('{"B":2,"_":4,"a":3,"b":1}')
  })
  it('writes scalars as JSON', () => {
    expect([canonicalJson(null), canonicalJson(7), canonicalJson('x'), canonicalJson(true)]).toEqual(['null', '7', '"x"', 'true'])
  })
})
