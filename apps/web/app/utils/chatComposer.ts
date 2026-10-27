import { shouldSendOnEnter } from './chatState'

export type ChatMention = { id: number; name: string }
export type ComposerKeyAction = 'next' | 'prev' | 'pick' | 'close' | 'send'

export const CHAT_TYPING_THROTTLE_MS = 3_000

function hasMention(text: string, name: string): boolean {
  const token = `@${name}`
  for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + 1)) {
    const before = text[at - 1]
    const after = text[at + token.length]
    if ((before === undefined || /\s/.test(before)) && (after === undefined || !/[\p{L}\p{N}_]/u.test(after))) return true
  }
  return false
}

/** The picked people whose `@name` is still in the text: deleting the name from the draft drops the mention. */
export function mentionIdsInText(text: string, picked: readonly ChatMention[]): number[] {
  return [...new Set(picked.filter(person => hasMention(text, person.name)).map(person => person.id))]
}

/** What a key does in the composer: with the mention list open it drives the list, otherwise Enter sends. */
export function composerKeyAction(
  event: { key: string; shiftKey: boolean; isComposing?: boolean },
  suggestionsOpen: boolean,
): ComposerKeyAction | null {
  if (suggestionsOpen && !event.isComposing) {
    if (event.key === 'ArrowDown') return 'next'
    if (event.key === 'ArrowUp') return 'prev'
    if (event.key === 'Enter' || event.key === 'Tab') return 'pick'
    if (event.key === 'Escape') return 'close'
  }
  return shouldSendOnEnter(event) && !suggestionsOpen ? 'send' : null
}

export function moveHighlight(index: number, step: 1 | -1, length: number): number {
  return length ? (index + step + length) % length : 0
}

export function shouldNotifyTyping(lastSentAt: number, now: number): boolean {
  return now - lastSentAt >= CHAT_TYPING_THROTTLE_MS
}
