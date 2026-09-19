import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../ProjectFieldHelp.vue'),
  'utf8',
)

describe('ProjectFieldHelp', () => {
  it('delegates hover-open, focus-open, outside dismiss, and Escape dismiss to UPopover', () => {
    expect(source).toContain('UPopover')
    expect(source).toContain('mode="hover"')
    expect(source).toContain('v-model:open="open"')
    expect(source).toContain('role="tooltip"')
    expect(source).toContain('aria-describedby')
    expect(source).toContain('aria-expanded')
    // Escape dismiss, outside pointerdown dismiss, hover-open and blur-close
    // are native to UPopover's hover mode: no document-level listeners or
    // manual outside-target detection are reimplemented here.
    expect(source).not.toContain('document.addEventListener')
    expect(source).not.toContain('document.removeEventListener')
    expect(source).not.toContain('onMounted')
    expect(source).not.toContain('onBeforeUnmount')
    expect(source).not.toContain('isHelpSurface')
    expect(source).not.toContain("event.key === 'Escape'")
    expect(source).not.toContain('UTooltip')
    expect(source).not.toContain('Dialog')
  })

  it('keeps the two handlers UPopover cannot provide: Enter/Space toggle and touch pointerdown toggle', () => {
    // HoverCardTrigger has no keyboard handling, so Enter/Space must be
    // handled explicitly to toggle the popover.
    expect(source).toContain('onKeydown')
    expect(source).toContain("event.key !== 'Enter'")
    // HoverCardTrigger's built-in touch support reacts to `pointerup`; this
    // component (and its e2e coverage) has always toggled on `pointerdown`.
    expect(source).toContain('onPointerDown')
    expect(source).toContain("event.pointerType !== 'touch'")
  })

  it('swallows the click so it cannot bubble into a surrounding label or form', () => {
    expect(source).toContain('onClick')
    expect(source).toContain('event.preventDefault()')
    expect(source).toContain('event.stopPropagation()')
  })
})
