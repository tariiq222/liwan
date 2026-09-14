import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Stripe density: 32px controls, hairline surfaces, 40px table rows, and one
// status-pill recipe. These live in the theme owners only.
const css = readFileSync(resolve(import.meta.dirname, '../css/components.css'), 'utf8')
const shell = readFileSync(resolve(import.meta.dirname, '../css/shell.css'), 'utf8')
const config = readFileSync(resolve(import.meta.dirname, '../../app.config.ts'), 'utf8')

describe('Stripe density recipes', () => {
  it('controls are 32px and use the md radius', () => {
    expect(config).toMatch(/button:[\s\S]*?base: 'min-h-8 rounded-md font-medium'/)
    expect(config).toMatch(/input: \{ slots: \{ base: 'nasq-ui-field min-h-8 rounded-md' \} \}/)
    expect(css).toMatch(/\.nasq-ui-icon-button \{[^}]*width: 2rem;[^}]*height: 2rem;/)
  })

  it('record surfaces are hairline, not shadowed; cards drop the 14px radius', () => {
    expect(css).toMatch(/\.nasq-ui-record-surface \{[^}]*border: 1px solid var\(--ui-border\)/)
    expect(css).not.toMatch(/\.nasq-ui-record-surface \{[^}]*box-shadow/)
    expect(config).toMatch(/card: \{ slots: \{ root: 'rounded-lg border border-default'/)
    expect(config).not.toContain('rounded-[14px]')
  })

  it('tables are 40px rows with hover and 12px muted heads', () => {
    expect(config).toMatch(/th: 'text-start text-xs font-medium text-muted px-3 py-2/)
    expect(config).toMatch(/td: 'text-start px-3 py-2 text-default/)
    expect(config).toMatch(/tr: 'hover:bg-surface-hover/)
  })

  it('ships the status pill, label, numeric and row-actions recipes', () => {
    for (const cls of ['.nasq-ui-status-pill', '.nasq-ui-label', '.nasq-ui-num', '.nasq-ui-row-actions']) expect(css).toContain(cls)
    expect(css).toMatch(/\.nasq-ui-status-pill \{[^}]*height: 22px/)
    for (const tone of ['in_progress', 'done', 'urgent', 'overdue', 'on_track']) expect(css).toContain(`[data-tone='${tone}']`)
  })

  it('page padding is 20/24/40 and the stack gap is 1.25rem', () => {
    expect(shell).toMatch(/\.nasq-shell-main \{[^}]*padding: 20px 24px 40px/)
    expect(shell).toMatch(/\.nasq-page-stack \{[^}]*gap: 1\.25rem/)
  })
})
