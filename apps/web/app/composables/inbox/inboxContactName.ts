import type { InboxContactRef } from '@liwan/contracts'

type Translate = (key: string, values?: Record<string, unknown>) => string

/**
 * The name a screen shows for a messaging contact. An erased contact keeps a stored language-neutral marker as its
 * `name`, so the screen shows its own translated name with the contact's number instead of the marker.
 */
export function inboxContactName(contact: Pick<InboxContactRef, 'id' | 'name' | 'erased'>, t: Translate): string {
  return contact.erased ? t('inbox.erasedContact', { id: contact.id }) : contact.name
}
