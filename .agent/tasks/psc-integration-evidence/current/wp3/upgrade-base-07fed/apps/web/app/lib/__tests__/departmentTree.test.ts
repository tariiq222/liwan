import { describe, expect, it } from 'vitest'
import {
  buildDepartmentTree,
  filterDepartmentTree,
  flattenDepartmentTree,
  getAllowedParentIds,
  type DepartmentTreeNode,
} from '../departmentTree'
import type { HrDepartment } from '@/composables/useHrDepartments'

function department(
  id: number,
  name: string,
  parent_id: number | null = null,
): HrDepartment {
  return { id, name, parent_id, manager: null, child_ids: [], employee_count: 0 }
}

function names(nodes: DepartmentTreeNode[]) {
  return nodes.map(({ department: item }) => item.name)
}

describe('department tree helpers', () => {
  it('keeps every parent before its alphabetically earlier child', () => {
    const roots = buildDepartmentTree([
      department(2, 'Alpha Child', 1),
      department(1, 'Zulu Parent'),
      department(3, 'Beta Root'),
    ])

    expect(names(flattenDepartmentTree(roots))).toEqual(['Beta Root', 'Zulu Parent', 'Alpha Child'])
  })

  it('excludes the edited department and all of its descendants as parents', () => {
    const records = [
      department(1, 'Company'),
      department(2, 'Engineering', 1),
      department(3, 'Platform', 2),
      department(4, 'Finance', 1),
    ]

    expect(getAllowedParentIds(records, 1)).toEqual([])
    expect(getAllowedParentIds(records, 2)).toEqual([1, 4])
    expect(getAllowedParentIds(records, 3)).toEqual([1, 2, 4])
  })

  it('preserves orphan and cyclic records without recursing forever or dropping records', () => {
    const roots = buildDepartmentTree([
      department(1, 'Cycle A', 2),
      department(2, 'Cycle B', 1),
      department(3, 'Orphan', 99),
      department(4, 'Child of orphan', 3),
    ])

    const flattened = flattenDepartmentTree(roots)

    expect(flattened).toHaveLength(4)
    expect(new Set(flattened.map(({ department: item }) => item.id))).toEqual(new Set([1, 2, 3, 4]))
    expect(flattened.some(({ department: item }) => item.id === 1)).toBe(true)
    expect(flattened.some(({ department: item }) => item.id === 2)).toBe(true)
  })

  it('excludes raw parent descendants even when cycle repair changes display roots', () => {
    const records = [
      department(1, 'Cycle A', 2),
      department(2, 'Cycle B', 1),
      department(3, 'Unrelated'),
    ]

    expect(getAllowedParentIds(records, 2)).toEqual([3])
  })

  it('retains matching descendants and every ancestor during search', () => {
    const roots = buildDepartmentTree([
      department(1, 'Operations'),
      department(2, 'Target Team', 1),
      department(3, 'Support Team', 1),
      department(4, 'Target Subteam', 2),
      department(5, 'Finance'),
    ])

    const filtered = filterDepartmentTree(roots, 'target')

    expect(names(filtered)).toEqual(['Operations'])
    expect(names(filtered[0]?.children ?? [])).toEqual(['Target Team'])
    expect(names(filtered[0]?.children[0]?.children ?? [])).toEqual(['Target Subteam'])
    expect(flattenDepartmentTree(filtered).some(({ department: item }) => item.name === 'Support Team')).toBe(false)
    expect(flattenDepartmentTree(filtered).some(({ department: item }) => item.name === 'Finance')).toBe(false)
  })
})
