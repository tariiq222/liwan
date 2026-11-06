import { useQueryClient } from '@tanstack/vue-query'
import { clearAiSessionState } from '../utils/aiDraft'
import { clearChatDrafts } from '../utils/chatDrafts'
import { useAiConversation } from './useAiConversation'

/**
 * Ends the session on the server, forgets what this browser kept for the user (cached queries, chat drafts, the
 * assistant's state, the sidebar preference) and goes to the sign-in page. Resolves `false`, leaving everything
 * local in place, when the server could not end the session.
 */
export function useSignOut() {
  const queryClient = useQueryClient()
  const { clear: clearAiConversation } = useAiConversation()
  const { me } = useMe()
  return async (): Promise<boolean> => {
    const navPreferenceKey = `liwan-nav:${me.value?.id ?? 'anonymous'}`
    try {
      await $fetch('/api/auth/logout', { method: 'POST', body: {} })
      sessionStorage.removeItem(navPreferenceKey)
      clearAiSessionState()
      clearChatDrafts()
      clearAiConversation()
      await queryClient.cancelQueries()
      queryClient.clear()
      await refreshNuxtData('me')
      await navigateTo('/login')
      return true
    } catch {
      await refreshNuxtData('me')
      return false
    }
  }
}
