import { describe, expect, it } from 'vitest'
import { buildDepartmentTree, filterDepartmentTree } from '../departmentTree'
import {
  ORG_NODE_HEIGHT,
  fitOrgChart,
  layoutDepartmentOrgChart,
  nextOrgScale,
  type OrgChartBox,
} from '../departmentOrgChart'
import type { HrDepartment } from '@/composables/useHrDepartments'

function department(
  id: number,
  name: string,
  parent_id: number | null = null,
  extra: { manager?: string; employee_count?: number } = {},
): HrDepartment {
  return {
    id,
    name,
    parent_id,
    manager: extra.manager ? { id: id + 100, name: extra.manager } : null,
    child_ids: [],
    employee_count: extra.employee_count ?? 0,
  }
}

function boxesOverlap(a: OrgChartBox, b: OrgChartBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function assertNoOverlaps(boxes: OrgChartBox[]) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(boxesOverlap(boxes[i]!, boxes[j]!), `${boxes[i]!.id}-${boxes[j]!.id}`).toBe(false)
    }
  }
}

describe('department org chart layout', () => {
  it('keeps deep, wide, and multi-root forests free of overlapping nodes', () => {
    const records = [
      department(1, 'الشركة', null, { manager: 'Admin', employee_count: 40 }),
      department(2, 'الهندسة', 1, { employee_count: 18 }),
      department(3, 'المنصة', 2),
      department(4, 'التشغيل', 3),
      department(5, 'الخدمات', 4),
      department(6, 'واجهات البرمجة', 5),
      department(7, 'المتحكمات', 6),
      department(8, 'الإدارة العامة للتخطيط الاستراتيجي والمتابعة المؤسسية في القطاعات التابعة', 7, { manager: 'سارة', employee_count: 2 }),
      department(9, 'الجودة', 2),
      department(10, 'الأمن', 2),
      department(11, 'البيانات', 2),
      department(12, 'فرع مستقل', null, { employee_count: 3 }),
    ]
    const layout = layoutDepartmentOrgChart(buildDepartmentTree(records))
    expect(layout.boxes).toHaveLength(12)
    expect(Math.max(...layout.boxes.map(box => box.depth))).toBe(7)
    expect(layout.boxes.filter(box => box.parentId === null)).toHaveLength(2)
    assertNoOverlaps(layout.boxes)
    const long = layout.boxes.find(box => box.id === 8)!
    const leaf = layout.boxes.find(box => box.id === 12)!
    expect(long.h).toBe(ORG_NODE_HEIGHT)
    expect(leaf.h).toBe(ORG_NODE_HEIGHT)
    expect(long.manager).toBe('سارة')
    expect(long.employeeCount).toBe(2)
    expect(layout.edges).toHaveLength(10)
  })

  it('keeps long manager names on the same fixed card height', () => {
    const layout = layoutDepartmentOrgChart(buildDepartmentTree([
      department(1, 'Short', null, { manager: 'A' }),
      department(2, 'Also short', null, {
        manager: 'Finance Shared Services and Long English Department Title for Wrapping',
      }),
    ]))
    expect(layout.boxes.every(box => box.h === ORG_NODE_HEIGHT && box.w === 220)).toBe(true)
    assertNoOverlaps(layout.boxes)
  })

  it('mirrors sibling order in RTL without overlaps', () => {
    const roots = buildDepartmentTree([
      department(1, 'Root'),
      department(2, 'Alpha', 1),
      department(3, 'Zulu', 1),
    ])
    const ltr = layoutDepartmentOrgChart(roots)
    const rtl = layoutDepartmentOrgChart(roots, { rtl: true })
    const ltrAlpha = ltr.boxes.find(box => box.id === 2)!
    const ltrZulu = ltr.boxes.find(box => box.id === 3)!
    const rtlAlpha = rtl.boxes.find(box => box.id === 2)!
    const rtlZulu = rtl.boxes.find(box => box.id === 3)!
    expect(ltrAlpha.x).toBeLessThan(ltrZulu.x)
    expect(rtlAlpha.x).toBeGreaterThan(rtlZulu.x)
    assertNoOverlaps(rtl.boxes)
  })

  it('lays out search hits with retained ancestors', () => {
    const roots = buildDepartmentTree([
      department(1, 'Operations'),
      department(2, 'Target Team', 1),
      department(3, 'Support Team', 1),
      department(4, 'Target Subteam', 2),
      department(5, 'Finance'),
    ])
    const layout = layoutDepartmentOrgChart(filterDepartmentTree(roots, 'target'))
    expect(layout.boxes.map(box => box.id).sort((a, b) => a - b)).toEqual([1, 2, 4])
    expect(layout.boxes.some(box => box.id === 3 || box.id === 5)).toBe(false)
    assertNoOverlaps(layout.boxes)
  })

  it('fits a large layout into the viewport without scaling above 1', () => {
    const roots = buildDepartmentTree([
      department(1, 'A'),
      department(2, 'B', 1),
      department(3, 'C', 1),
      department(4, 'D', 1),
    ])
    const layout = layoutDepartmentOrgChart(roots)
    const fit = fitOrgChart(layout, 320, 240)
    expect(fit.scale).toBeLessThanOrEqual(1)
    expect(fit.scale).toBeGreaterThan(0)
    expect(layout.width * fit.scale).toBeLessThanOrEqual(320)
    expect(layout.height * fit.scale).toBeLessThanOrEqual(240)
  })

  it('keeps zoom monotonic when fit is below the usual minimum', () => {
    const roots = buildDepartmentTree([
      department(1, 'A'),
      department(2, 'B', 1),
      department(3, 'C', 1),
      department(4, 'D', 1),
      department(5, 'E', 1),
      department(6, 'F', 1),
    ])
    const layout = layoutDepartmentOrgChart(roots)
    const fit = fitOrgChart(layout, 80, 60)
    expect(fit.scale).toBeLessThan(0.25)
    expect(nextOrgScale(fit.scale, 1 / 1.2)).toBe(fit.scale)
    expect(nextOrgScale(fit.scale, 1.2)).toBeGreaterThan(fit.scale)
    expect(nextOrgScale(fit.scale, 1.2)).toBeLessThan(0.25)
  })
})
