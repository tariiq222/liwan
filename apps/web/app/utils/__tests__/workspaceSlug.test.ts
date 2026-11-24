import { describe, expect, it } from 'vitest'
import { suggestWorkspaceSlug, workspaceSlugShapeOk } from '../workspaceSlug'

describe('workspace slug on the client', () => {
  it('accepts the shapes the contract accepts and refuses the rest', () => {
    for (const ok of ['acme', 'acme-2', 'a1b']) expect(workspaceSlugShapeOk(ok)).toBe(true)
    for (const bad of ['ab', 'a'.repeat(31), '-acme', 'acme-', 'a--b', '1234', 'Acme', 'acme co']) expect(workspaceSlugShapeOk(bad)).toBe(false)
  })

  it('suggests from the Latin company name, then the email domain, else nothing', () => {
    expect(suggestWorkspaceSlug('Acme Trading Co.', 'x@other.sa')).toBe('acme-trading-co')
    expect(suggestWorkspaceSlug('شركة الأفق', 'sara@ofoq.com.sa')).toBe('ofoq')
    expect(suggestWorkspaceSlug('شركة', 'sara@12.sa')).toBe('')
  })
})
