/**
 * Every row of a list route, read in the server's page size until its `total` is reached or a page comes back empty. `total` stays
 * the server's, so a short read shows as `items.length < total`. The abort signal stops the loop between pages; each request
 * gets the same signal from its caller.
 */
export async function fetchAllPages<T>(
  fetchPage: (offset: number) => Promise<{ items: T[]; total: number }>,
  signal?: AbortSignal,
): Promise<{ items: T[]; total: number }> {
  const items: T[] = []
  for (;;) {
    signal?.throwIfAborted()
    const page = await fetchPage(items.length)
    items.push(...page.items)
    if (page.items.length === 0 || items.length >= page.total) return { items, total: page.total }
  }
}
