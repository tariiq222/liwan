import type { HrDepartment } from '@/composables/useHrDepartments'

export type DepartmentTreeNode = {
  department: HrDepartment
  children: DepartmentTreeNode[]
  depth: number
}

function compareDepartments(a: HrDepartment, b: HrDepartment): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id
}

/**
 * Build a deterministic forest from the server's parent ids. Broken parent
 * references become roots. For a cycle, the lowest id in each cycle becomes
 * that cycle's root, which keeps every record visible while removing one
 * unsafe edge.
 */
export function buildDepartmentTree(departments: HrDepartment[]): DepartmentTreeNode[] {
  const byId = new Map(departments.map((department) => [department.id, department]))
  const effectiveParent = new Map<number, number | null>()
  for (const department of departments) {
    effectiveParent.set(department.id, byId.has(department.parent_id ?? 0) ? department.parent_id : null)
  }

  const visited = new Set<number>()
  for (const department of departments) {
    if (visited.has(department.id)) continue
    const index = new Map<number, number>()
    const path: number[] = []
    let current: number | null = department.id
    while (current !== null && byId.has(current) && !visited.has(current)) {
      const prior = index.get(current)
      if (prior !== undefined) {
        const cycle = path.slice(prior)
        const cycleRoot = Math.min(...cycle)
        effectiveParent.set(cycleRoot, null)
        break
      }
      index.set(current, path.length)
      path.push(current)
      current = effectiveParent.get(current) ?? null
    }
    for (const id of path) visited.add(id)
  }

  const childrenByParent = new Map<number, HrDepartment[]>()
  const roots: HrDepartment[] = []
  for (const department of departments) {
    const parentId = effectiveParent.get(department.id) ?? null
    if (parentId === null) {
      roots.push(department)
      continue
    }
    const children = childrenByParent.get(parentId) ?? []
    children.push(department)
    childrenByParent.set(parentId, children)
  }

  const makeNode = (department: HrDepartment, depth: number, path: Set<number>): DepartmentTreeNode => {
    // The cycle pass above removes cyclic edges. Keep this guard as a final
    // safety net if duplicate or concurrently changing input reaches here.
    if (path.has(department.id)) return { department, children: [], depth }
    const nextPath = new Set(path).add(department.id)
    const children = (childrenByParent.get(department.id) ?? [])
      .filter((child) => !nextPath.has(child.id))
      .sort(compareDepartments)
      .map((child) => makeNode(child, depth + 1, nextPath))
    return { department, children, depth }
  }

  return roots.sort(compareDepartments).map((root) => makeNode(root, 0, new Set()))
}

export function flattenDepartmentTree(nodes: DepartmentTreeNode[]): DepartmentTreeNode[] {
  const result: DepartmentTreeNode[] = []
  const walk = (node: DepartmentTreeNode) => {
    result.push(node)
    for (const child of node.children) walk(child)
  }
  for (const node of nodes) walk(node)
  return result
}

export function getAllowedParentIds(departments: HrDepartment[], editingId: number | null): number[] {
  if (editingId === null) return departments.map(({ id }) => id).sort((a, b) => a - b)
  const excluded = new Set<number>([editingId])
  const childrenByParent = new Map<number, number[]>()
  for (const department of departments) {
    if (department.parent_id === null) continue
    const children = childrenByParent.get(department.parent_id) ?? []
    children.push(department.id)
    childrenByParent.set(department.parent_id, children)
  }
  const pending = [editingId]
  while (pending.length) {
    const parentId = pending.pop()!
    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (excluded.has(childId)) continue
      excluded.add(childId)
      pending.push(childId)
    }
  }
  return departments
    .map(({ id }) => id)
    .filter((id) => !excluded.has(id))
    .sort((a, b) => a - b)
}

export function filterDepartmentTree(nodes: DepartmentTreeNode[], query: string): DepartmentTreeNode[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return nodes
  const filter = (node: DepartmentTreeNode): DepartmentTreeNode | null => {
    const children = node.children.map(filter).filter((child): child is DepartmentTreeNode => child !== null)
    const matches = node.department.name.toLocaleLowerCase().includes(normalized)
    if (!matches && children.length === 0) return null
    return { ...node, children }
  }
  return nodes.map(filter).filter((node): node is DepartmentTreeNode => node !== null)
}
