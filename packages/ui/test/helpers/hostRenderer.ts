import { createRenderer, type App } from 'vue'

// There is no DOM environment in this suite, so components mount against a
// plain object tree instead. That is enough to run setup, lifecycle hooks and
// real vue-router guards — the parts under test — without pulling in jsdom.
export interface HostNode {
  children: HostNode[]
  parent: HostNode | null
  props: Record<string, unknown>
  text?: string
  type?: string
  getRootNode(): HostNode
}

// RouterView compares the rendered element's root with the app container's root
// (Node.getRootNode) before it reports a settled route, so every node answers it.
const hostNodeMethods = {
  getRootNode(this: HostNode): HostNode {
    return this.parent ? this.parent.getRootNode() : this
  },
}

function hostNode(fields: Omit<HostNode, 'getRootNode'>): HostNode {
  return Object.assign(Object.create(hostNodeMethods) as HostNode, fields)
}

export function createHostNode(type = 'root'): HostNode {
  return hostNode({ type, children: [], parent: null, props: {} })
}

export const hostRenderer = createRenderer<HostNode, HostNode>({
  patchProp(node, key, _oldValue, value) {
    node.props[key] = value
  },
  insert(child, parent, anchor) {
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index === -1) parent.children.push(child)
    else parent.children.splice(index, 0, child)
  },
  remove(child) {
    if (!child.parent) return
    const index = child.parent.children.indexOf(child)
    if (index !== -1) child.parent.children.splice(index, 1)
    child.parent = null
  },
  createElement: type => createHostNode(type),
  createText: text => hostNode({ text, children: [], parent: null, props: {} }),
  createComment: text => hostNode({ text, type: 'comment', children: [], parent: null, props: {} }),
  setText(node, text) { node.text = text },
  setElementText(node, text) { node.text = text; node.children = [] },
  parentNode: node => node.parent,
  nextSibling(node) {
    if (!node.parent) return null
    return node.parent.children[node.parent.children.indexOf(node) + 1] ?? null
  },
  querySelector: () => null,
  setScopeId: () => {},
  cloneNode: node => hostNode({ ...node, children: [...node.children], props: { ...node.props }, parent: null }),
  insertStaticContent(content, parent, anchor) {
    const node = createHostNode('static')
    node.text = content
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index === -1) parent.children.push(node)
    else parent.children.splice(index, 0, node)
    return [node, node]
  },
})

export function findNode(node: HostNode, predicate: (candidate: HostNode) => boolean): HostNode | undefined {
  if (predicate(node)) return node
  for (const child of node.children) {
    const match = findNode(child, predicate)
    if (match) return match
  }
  return undefined
}

export function findNodes(node: HostNode, predicate: (candidate: HostNode) => boolean): HostNode[] {
  const matches = predicate(node) ? [node] : []
  return matches.concat(...node.children.map(child => findNodes(child, predicate)))
}

export type HostApp = App<HostNode>
