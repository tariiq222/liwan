import { describe, expect, it } from 'vitest'
import { overlayOwnsEscape } from '../useEscapeBack'

// A slide-over stamps `data-dismissable-layer` on itself so the page's shortcuts stand down while it is open. Its own
// Escape handler asks this function whether some *other* layer owns the key; without the `except` argument it found the
// panel itself and Escape did nothing at all — the panel was open and could not be closed by keyboard.
describe('overlayOwnsEscape', () => {
  /** A fake document that reports `found` for the layer selector. */
  const host = (found: unknown) => ({ querySelector: () => found })
  /** A fake element whose subtree contains `inner`. */
  const layer = (inner: unknown) => ({ contains: (node: unknown) => node === inner })

  it('reports nothing when no layer is open', () => {
    expect(overlayOwnsEscape(host(null))).toBe(false)
  })

  it('reports a layer that is not the caller', () => {
    const other = {}
    expect(overlayOwnsEscape(host(other))).toBe(true)
  })

  it('ignores the caller\'s own layer, so its Escape still closes it', () => {
    const self = {}
    expect(overlayOwnsEscape(host(self), layer(self))).toBe(false)
  })

  it('still reports a layer nested inside the caller as someone else\'s', () => {
    const self = {}
    const nested = {}
    // A menu opened from inside the panel is a layer the panel does not own: it closes first.
    expect(overlayOwnsEscape(host(nested), { contains: () => false })).toBe(true)
    expect(overlayOwnsEscape(host(self), layer(self))).toBe(false)
  })

  it('falls back to a plain answer when the caller has no containment test', () => {
    expect(overlayOwnsEscape(host({}), null)).toBe(true)
    expect(overlayOwnsEscape(host({}), {})).toBe(true)
  })
})
