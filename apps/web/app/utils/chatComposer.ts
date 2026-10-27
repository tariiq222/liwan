import { shouldSendOnEnter } from './chatState'

export type ChatMention = { id: number; name: string }
export type ComposerKeyAction = 'next' | 'prev' | 'pick' | 'close' | 'send'

export const CHAT_TYPING_THROTTLE_MS = 3_000

const SPAN = '\u0000'

// Replaces the first `@name` that stands alone (a space or the text edge before, no letter after) with filler and reports it.
function consumeMention(text: string, name: string): string | null {
  const token = `@${name}`
  for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + 1)) {
    const before = text[at - 1]
    const after = text[at + token.length]
    if ((before === undefined || /\s/.test(before)) && (after === undefined || !/[\p{L}\p{N}_]/u.test(after))) {
      return text.slice(0, at) + SPAN.repeat(token.length) + text.slice(at + token.length)
    }
  }
  return null
}

/**
 * The people whose `@name` is still in the text: deleting the name from the draft drops the mention. Longer names are
 * matched first and each match is consumed, so "@Ali Hassan" does not also mention "Ali". A display name shared by
 * two people is ambiguous: the other members resolve only through `picked`, the people chosen from the suggestions.
 */
export function mentionIdsInText(text: string, picked: readonly ChatMention[], others: readonly ChatMention[] = []): number[] {
  const pickedIds = new Set(picked.map(person => person.id))
  const holders = new Map<string, Set<number>>()
  for (const person of [...picked, ...others]) holders.set(person.name, (holders.get(person.name) ?? new Set()).add(person.id))
  const candidates = [...picked, ...others.filter(person => !pickedIds.has(person.id) && holders.get(person.name)!.size === 1)]
  const found = new Set<number>()
  let rest = text
  for (const person of [...candidates].sort((x, y) => y.name.length - x.name.length)) {
    const next = consumeMention(rest, person.name)
    if (next === null) continue
    rest = next
    found.add(person.id)
  }
  return candidates.filter(person => found.has(person.id)).map(person => person.id).filter((id, index, ids) => ids.indexOf(id) === index)
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
