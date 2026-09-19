import type { DepartmentTreeNode } from '@/lib/departmentTree'

/** Chart x/y are LTR coordinates. The viewport must be dir=ltr so scrollLeft and inset-inline-start match these values. */
const ORG_NODE_WIDTH = 220
export const ORG_NODE_HEIGHT = 96
const ORG_H_GAP = 32
const ORG_V_GAP = 64
const ORG_PAD = 32
const ORG_ROOT_GAP = 48
const ORG_MIN_SCALE = 0.25
const ORG_MAX_SCALE = 2.5

export type OrgChartBox = {
  id: number
  name: string
  manager: string | null
  employeeCount: number
  depth: number
  parentId: number | null
  x: number
  y: number
  w: number
  h: number
}

type OrgChartEdge = {
  from: number
  to: number
  d: string
}

type OrgChartLayout = {
  boxes: OrgChartBox[]
  edges: OrgChartEdge[]
  width: number
  height: number
}

type Sized = {
  node: DepartmentTreeNode
  subtreeW: number
  children: Sized[]
}

function measure(node: DepartmentTreeNode): Sized {
  const children = node.children.map(measure)
  const childrenW = children.reduce((sum, child, index) => sum + child.subtreeW + (index ? ORG_H_GAP : 0), 0)
  return { node, children, subtreeW: Math.max(ORG_NODE_WIDTH, childrenW) }
}

function place(
  sized: Sized,
  left: number,
  top: number,
  parentId: number | null,
  boxes: OrgChartBox[],
) {
  const childrenW = sized.children.reduce((sum, child, index) => sum + child.subtreeW + (index ? ORG_H_GAP : 0), 0)
  boxes.push({
    id: sized.node.department.id,
    name: sized.node.department.name,
    manager: sized.node.department.manager?.name ?? null,
    employeeCount: sized.node.department.employee_count,
    depth: sized.node.depth,
    parentId,
    x: left + Math.max(0, (sized.subtreeW - ORG_NODE_WIDTH) / 2),
    y: top,
    w: ORG_NODE_WIDTH,
    h: ORG_NODE_HEIGHT,
  })
  let childLeft = left + Math.max(0, (sized.subtreeW - childrenW) / 2)
  const childTop = top + ORG_NODE_HEIGHT + ORG_V_GAP
  for (const child of sized.children) {
    place(child, childLeft, childTop, sized.node.department.id, boxes)
    childLeft += child.subtreeW + ORG_H_GAP
  }
}

function edgePath(parent: OrgChartBox, child: OrgChartBox): string {
  const x1 = parent.x + parent.w / 2
  const y1 = parent.y + parent.h
  const x2 = child.x + child.w / 2
  const y2 = child.y
  const mid = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`
}

function flipRtl(layout: OrgChartLayout): OrgChartLayout {
  const boxes = layout.boxes.map(box => ({ ...box, x: layout.width - box.x - box.w }))
  const byId = new Map(boxes.map(box => [box.id, box]))
  const edges = boxes.flatMap((box) => {
    if (box.parentId === null) return []
    const parent = byId.get(box.parentId)
    return parent ? [{ from: parent.id, to: box.id, d: edgePath(parent, box) }] : []
  })
  return { ...layout, boxes, edges }
}

export function layoutDepartmentOrgChart(
  roots: DepartmentTreeNode[],
  options: { rtl?: boolean } = {},
): OrgChartLayout {
  if (!roots.length) return { boxes: [], edges: [], width: ORG_PAD * 2, height: ORG_PAD * 2 }
  const measured = roots.map(measure)
  const forestW = measured.reduce((sum, tree, index) => sum + tree.subtreeW + (index ? ORG_ROOT_GAP : 0), 0)
  const boxes: OrgChartBox[] = []
  let left = ORG_PAD
  for (const tree of measured) {
    place(tree, left, ORG_PAD, null, boxes)
    left += tree.subtreeW + ORG_ROOT_GAP
  }
  const byId = new Map(boxes.map(box => [box.id, box]))
  const edges: OrgChartEdge[] = []
  for (const box of boxes) {
    if (box.parentId === null) continue
    const parent = byId.get(box.parentId)
    if (parent) edges.push({ from: parent.id, to: box.id, d: edgePath(parent, box) })
  }
  const layout: OrgChartLayout = {
    boxes,
    edges,
    width: forestW + ORG_PAD * 2,
    height: Math.max(...boxes.map(box => box.y + box.h)) + ORG_PAD,
  }
  return options.rtl ? flipRtl(layout) : layout
}

export function nextOrgScale(current: number, factor: number): number {
  const raw = current * factor
  const floor = Math.min(ORG_MIN_SCALE, current)
  return Math.min(ORG_MAX_SCALE, Math.max(floor, raw))
}

export function fitOrgChart(
  layout: OrgChartLayout,
  viewportW: number,
  viewportH: number,
  padding = 16,
): { scale: number; scrollX: number; scrollY: number } {
  const availW = Math.max(1, viewportW - padding * 2)
  const availH = Math.max(1, viewportH - padding * 2)
  const scale = Math.min(1, availW / Math.max(1, layout.width), availH / Math.max(1, layout.height))
  const contentW = layout.width * scale
  const contentH = layout.height * scale
  return {
    scale,
    scrollX: Math.max(0, (contentW - viewportW) / 2),
    scrollY: Math.max(0, (contentH - viewportH) / 2),
  }
}
