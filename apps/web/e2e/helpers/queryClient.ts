import type { Page } from '@playwright/test'

/** Test-only, read-only Vue tree inspection; cache mutation uses QueryClient's public API. */
export async function clearRenderedQueryCache(page: Page) {
  return page.evaluate(() => {
    type Client = { clear(): void; getQueryCache(): { getAll(): unknown[] } }
    type RenderedNode = {
      component?: { provides: Record<string, unknown>; subTree?: RenderedNode }
      suspense?: { activeBranch?: RenderedNode }
      children?: unknown[]
    }
    // Production Vue retains the rendered vnode on its mount container. Unlike
    // the app context, this tree reaches the currently mounted session provider.
    const root = document.querySelector('#__nuxt') as (Element & { _vnode?: RenderedNode }) | null
    const clients = new Set<Client>()
    const visited = new Set<RenderedNode>()
    function visit(value: unknown) {
      if (!value || typeof value !== 'object') return
      const node = value as RenderedNode
      if (visited.has(node)) return
      visited.add(node)
      const candidate = node.component?.provides.VUE_QUERY_CLIENT as Client | undefined
      if (candidate && typeof candidate.clear === 'function' && typeof candidate.getQueryCache === 'function') clients.add(candidate)
      visit(node.component?.subTree)
      visit(node.suspense?.activeBranch)
      if (Array.isArray(node.children)) node.children.forEach(visit)
    }
    visit(root?._vnode)
    if (clients.size !== 1) throw new Error(`Expected one rendered query client, found ${clients.size}`)
    const client = [...clients][0]!
    const cache = client.getQueryCache()
    const before = cache.getAll().length
    client.clear()
    return { before, after: cache.getAll().length }
  })
}
