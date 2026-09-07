import { describe, expect, it } from 'vitest'
import { permissionDiff } from '../permissionDiff'

const source = {
  role_assignment_id: 44,
  role: { id: 4, key: 'hr_manager', name: { ar: 'الموارد البشرية', en: 'HR' }, type: 'built_in' as const, protected: true },
  scope: { kind: 'company' as const, id: 1, name: 'شركة المثال' },
  source: 'assignment' as const,
}

describe('permissionDiff', () => {
  it('separates added, removed, and retained capabilities without dropping retained sources', () => {
    const before = [{ key: 'hr.employees.read' as const, sources: [source] }, { key: 'access.audit.read' as const, sources: [] }]
    const after = [{ key: 'hr.employees.read' as const, sources: [source] }, { key: 'pmo.tasks.read' as const, sources: [] }]
    const diff = permissionDiff(before, after)
    expect(diff.added.map((capability) => capability.key)).toEqual(['pmo.tasks.read'])
    expect(diff.removed.map((capability) => capability.key)).toEqual(['access.audit.read'])
    expect(diff.retained[0]).toEqual(after[0])
    expect(diff.retained[0]?.sources[0]?.role_assignment_id).toBe(44)
  })
})
