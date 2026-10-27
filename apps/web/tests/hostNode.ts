/**
 * Adds `getRootNode` to a node of a test's object-tree renderer.
 *
 * RouterView compares the rendered element's root with the app container's root
 * (Node.getRootNode) before it reports a settled route, so every host node a
 * test mounts a router into must answer it.
 */
export function rootedNode<T extends { parent: unknown }>(fields: T): T & { getRootNode(): unknown } {
  return {
    ...fields,
    getRootNode() {
      let node: { parent: unknown } = this
      while (node.parent) node = node.parent as { parent: unknown }
      return node
    },
  }
}
