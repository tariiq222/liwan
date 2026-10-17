/**
 * A deterministic soft colour for an avatar, chosen from the record id so the same person always
 * gets the same hue. Light: pale fill, dark text; dark mode: deep fill, pale text.
 */
export interface AvatarTone { hue: string; angle: number; class: string; style: Record<string, string> }

// Eight hues spread around the OKLCH wheel. The colour is computed from `--avatar-hue` (set inline by
// the avatar), so no palette class is named and the tenant theme stays the only colour source.
const AVATAR_CLASS = 'bg-[oklch(0.94_0.045_var(--avatar-hue))] text-[oklch(0.38_0.1_var(--avatar-hue))] dark:bg-[oklch(0.32_0.07_var(--avatar-hue))] dark:text-[oklch(0.88_0.07_var(--avatar-hue))]'
const HUES: readonly [string, number][] = [['sky', 235], ['teal', 190], ['amber', 80], ['violet', 295], ['rose', 10], ['emerald', 155], ['indigo', 270], ['orange', 50]]
const TONES: readonly AvatarTone[] = HUES.map(([hue, angle]) => ({ hue, angle, class: AVATAR_CLASS, style: { '--avatar-hue': String(angle) } }))

export const AVATAR_TONE_COUNT = TONES.length

/** The tone for an id; a missing or non-numeric id falls back to a hash of its text. */
export function avatarTone(id: number | string | null | undefined): AvatarTone {
  let n: number
  if (typeof id === 'number' && Number.isFinite(id)) n = Math.trunc(Math.abs(id))
  else {
    const text = String(id ?? '')
    n = 0
    for (let i = 0; i < text.length; i += 1) n = (n * 31 + text.charCodeAt(i)) >>> 0
  }
  return TONES[n % TONES.length]!
}

const LETTER = /[\p{L}\p{N}]/u

/** First letter (code point) of a word, skipping leading punctuation; empty when there is none. */
function firstLetter(word: string): string {
  // "العلي" is initialled by ع, not by the article ا.
  const bare = /^ال.{2,}/u.test(word) ? word.slice(2) : word
  const found = Array.from(bare).find(char => LETTER.test(char))
  return found ? found.toLocaleUpperCase() : ''
}

/**
 * Initials from the first and last word of a name (works for Arabic and Latin): "سارة محمد العلي" -> "سع",
 * "Sara" -> "S". Arabic letters have no case, so they are returned as written.
 */
export function avatarInitials(name: string | null | undefined): string {
  const words = (name ?? '').split(/\s+/).filter(word => firstLetter(word))
  if (words.length === 0) return ''
  const first = firstLetter(words[0]!)
  if (words.length === 1) return first
  return `${first}${firstLetter(words[words.length - 1]!)}`
}

/** UAvatar props for a person: `<UAvatar v-bind="avatarProps(name, id)" size="xs" />`. Decorative, the name sits beside it. */
export function avatarProps(name: string | null | undefined, id: number | string | null | undefined) {
  const tone = avatarTone(id)
  return { text: avatarInitials(name), alt: '', 'aria-hidden': 'true', class: `${tone.class} font-medium select-none`, style: tone.style, 'data-tone': tone.hue }
}
