import type { AppRecordOption } from './types'

/** Walks server pages until a short page, so a record picker hands callers a single array. */
export async function fetchAllRecordOptions(
  requestPage: (offset: number) => Promise<AppRecordOption[]>,
  pageSize: number,
  signal?: AbortSignal,
): Promise<AppRecordOption[]> {
  const items: AppRecordOption[] = []
  let offset = 0
  while (true) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    }
    const page = await requestPage(offset)
    items.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return items
}
