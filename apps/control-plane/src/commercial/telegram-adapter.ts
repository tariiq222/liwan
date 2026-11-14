export interface TelegramSender {
  send(text: string): Promise<void>
}

/** Carries a short machine code only: the request address holds the bot token, so no transport text is ever kept. */
export class TelegramError extends Error {
  constructor(public code: string) {
    super(code)
    this.name = 'TelegramError'
  }
}

const TELEGRAM_API = 'https://api.telegram.org'
const TELEGRAM_TIMEOUT_MS = 10_000
/** The Bot API refuses a message longer than 4096 characters. */
const TELEGRAM_TEXT_MAX = 4000

export type TelegramConfig = { token: string; chatId: string; timeoutMs?: number; fetchImpl?: typeof fetch }

/** Plain `sendMessage` to one chat: no parse mode, so nothing in the text (a customer's company name) is read as markup. */
export class BotApiTelegramSender implements TelegramSender {
  constructor(private readonly cfg: TelegramConfig) {}

  async send(text: string): Promise<void> {
    const call = this.cfg.fetchImpl ?? fetch
    let response: Response
    try {
      response = await call(`${TELEGRAM_API}/bot${this.cfg.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.cfg.chatId, text: text.slice(0, TELEGRAM_TEXT_MAX), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? TELEGRAM_TIMEOUT_MS),
      })
    } catch (error) {
      throw new TelegramError(error instanceof Error && error.name === 'TimeoutError' ? 'telegram_timeout' : 'telegram_network_error')
    }
    if (!response.ok) throw new TelegramError(`telegram_http_${response.status}`)
    const body = await response.json().catch(() => null) as { ok?: boolean } | null
    if (body?.ok !== true) throw new TelegramError('telegram_rejected')
  }
}

/** The same two variables `deploy/alerts.py` reads, so the operator creates the bot once. Neither set: no channel; one set: a loud error. */
export function telegramSenderFromEnv(env: Record<string, string | undefined>): TelegramSender | null {
  const token = env.LIWAN_ALERT_TELEGRAM_BOT_TOKEN || undefined
  const chatId = env.LIWAN_ALERT_TELEGRAM_CHAT_ID || undefined
  if (!token && !chatId) return null
  if (!token || !chatId) throw new TelegramError('telegram_not_configured')
  return new BotApiTelegramSender({ token, chatId })
}
