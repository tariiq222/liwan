// The provider (Meta) answers failures in English and with codes; the thread and the channel pages show them to
// Arabic-speaking agents. Known failures get a translated line, everything else keeps the provider text behind a
// visible "Meta:" tag so nobody mistakes it for a product message.
const KNOWN_BY_CODE: ReadonlyMap<number, string> = new Map([
  [190, 'tokenInvalid'],
  [4, 'rateLimited'],
  [80007, 'rateLimited'],
  [130429, 'rateLimited'],
  [131056, 'rateLimited'],
  [131047, 'windowClosed'],
  [131026, 'recipient'],
])

const KNOWN_BY_TEXT: readonly [RegExp, string][] = [
  [/invalid oauth|access token|\b190\b/i, 'tokenInvalid'],
  [/rate limit|too many|130429|131056/i, 'rateLimited'],
  [/24[- ]hour|re-?engagement|window/i, 'windowClosed'],
  [/unreachable|timeout|timed out|connection|proxy|network/i, 'unreachable'],
  [/recipient|not a valid whatsapp|131026|undeliverable/i, 'recipient'],
]

/** The translated failure of a provider answer: its numeric code first, then the text; null when nothing is known. */
export function inboxProviderErrorKey(raw: string | null | undefined, code?: number | null): string | null {
  const byCode = code == null ? undefined : KNOWN_BY_CODE.get(code)
  if (byCode) return byCode
  const value = (raw ?? '').trim()
  if (!value) return null
  const known = KNOWN_BY_TEXT.find(([pattern]) => pattern.test(value))
  return known ? known[1] : null
}

export function useInboxProviderError() {
  const { t } = useI18n()
  function providerText(raw: string | null | undefined, code?: number | null): string {
    const value = (raw ?? '').trim()
    if (!value) return ''
    const key = inboxProviderErrorKey(value, code)
    if (key) return t(`inbox.providerError.${key}`)
    return t('inbox.providerError.unknown', { message: value })
  }
  return { providerText }
}
