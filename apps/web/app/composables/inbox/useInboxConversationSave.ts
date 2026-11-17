import type { InboxConversationDetail, InboxConversationPatch } from '@liwan/contracts'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { usePatchInboxConversation } from './useInbox'

/**
 * The one way a conversation is changed from the thread header and from the contact panel: it sends the revision the
 * user saw, shows the error toast when the server refuses, and exposes `patching` so a control locks while a patch runs.
 */
export function useInboxConversationSave(conversation: MaybeRefOrGetter<InboxConversationDetail>) {
  const { t } = useI18n()
  const toast = useToast()
  const { mutate, isPending: patching } = usePatchInboxConversation(() => toValue(conversation).id)
  function save(body: Omit<InboxConversationPatch, 'revision'>) {
    mutate({ ...body, revision: toValue(conversation).revision }, { onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }) })
  }
  return { save, patching }
}
