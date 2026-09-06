import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../ProjectFieldHelp.vue'),
  'utf8',
)

describe('ProjectFieldHelp', () => {
  it('owns open state for hover, focus, Enter toggle, Escape, and touch without Reka click close', () => {
    expect(source).toContain('TooltipProvider')
    expect(source).toContain('TooltipTrigger')
    expect(source).toContain('TooltipContent')
    expect(source).toContain('role="tooltip"')
    expect(source).toContain('aria-describedby')
    expect(source).toContain('aria-expanded')
    expect(source).toContain('onFocus')
    expect(source).toContain('onPointerEnter')
    expect(source).toContain('onPointerDown')
    expect(source).toContain("event.key === 'Escape'")
    expect(source).toContain("event.key === 'Enter'")
    expect(source).toContain("event.pointerType === 'touch'")
    expect(source).toContain('onDocumentPointerDown')
    expect(source).toContain('onDocumentKeydown')
    expect(source).not.toContain('@update:open')
    expect(source).not.toContain('Popover')
    expect(source).not.toContain('Dialog')
  })
})
