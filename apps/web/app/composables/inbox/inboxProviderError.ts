// The provider (Meta) answers failures in English and with codes; the thread and the channel pages show them to
// Arabic-speaking agents. Known failures get a translated line, everything else keeps the provider text behind a
// visible "Meta:" tag so nobody mistakes it for a product message.
const KNOWN: readonly [RegExp, string][] = [
  [/did not confirm/i, 'uncertain'],
  [/invalid oauth|access token|\b190\b/i, 'tokenInvalid'],
  [/rate limit|too many|130429|131056/i, 'rateLimited'],
  [/24[- ]hour|re-?engagement|window/i, 'windowClosed'],
  [/unreachable|timeout|timed out|connection|proxy|network/i, 'unreachable'],
  [/recipient|not a valid whatsapp|131026|undeliverable/i, 'recipient'],
]

export function useInboxProviderError() {
  const { t } = useI18n()
  function providerText(raw: string | null | undefined): string {
    const value = (raw ?? '').trim()
    if (!value) return ''
    const known = KNOWN.find(([pattern]) => pattern.test(value))
    if (known) return t(`inbox.providerError.${known[1]}`)
    return t('inbox.providerError.unknown', { message: value })
  }
  return { providerText }
}
