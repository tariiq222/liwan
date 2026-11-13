import { useMutation } from '@tanstack/vue-query'
import { saveBlob } from '../../utils/saveBlob'
import { inboxListQuery, type InboxListRoute } from './inboxListRoute'

export const INBOX_CONVERSATIONS_EXPORT_PATH = '/api/v1/inbox/conversations/export.csv'
const FALLBACK_FILENAME = 'inbox-conversations.csv'

/** The export takes the list's filters, not its page window. */
export function inboxExportQuery(route: InboxListRoute): Record<string, string | number> {
  const { limit: _limit, offset: _offset, ...filters } = inboxListQuery(route)
  return filters
}

/** Downloads the conversations the list shows as CSV, named by the server. */
export function useInboxConversationsExport() {
  const { $download } = useApi()
  return useMutation({
    mutationFn: async (route: InboxListRoute) => {
      const { blob, filename } = await $download(INBOX_CONVERSATIONS_EXPORT_PATH, { query: inboxExportQuery(route) })
      saveBlob(blob, filename ?? FALLBACK_FILENAME)
    },
  })
}
