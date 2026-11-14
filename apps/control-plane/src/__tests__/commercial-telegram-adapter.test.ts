import { describe, expect, it } from 'vitest'
import { BotApiTelegramSender, telegramSenderFromEnv } from '../commercial/telegram-adapter.js'

describe('telegram alert sender', () => {
  const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  it('posts plain text with no parse mode to the configured chat', async () => {
    const calls: { url: string; body: any }[] = []
    const sender = new BotApiTelegramSender({ token: 'tok-123', chatId: '42', fetchImpl: (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return ok() }) as never })
    await sender.send('*bold* <b>x</b>')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.telegram.org/bottok-123/sendMessage')
    expect(calls[0].body).toEqual({ chat_id: '42', text: '*bold* <b>x</b>', disable_web_page_preview: true })
  })
  it('fails with a short code that never carries the token', async () => {
    const down = new BotApiTelegramSender({ token: 'secret-token', chatId: '1', fetchImpl: (async () => { throw new Error('connect ECONNREFUSED https://api.telegram.org/botsecret-token/sendMessage') }) as never })
    await expect(down.send('x')).rejects.toMatchObject({ code: 'telegram_network_error', message: 'telegram_network_error' })
    const refused = new BotApiTelegramSender({ token: 'secret-token', chatId: '1', fetchImpl: (async () => new Response('{}', { status: 401 })) as never })
    await expect(refused.send('x')).rejects.toMatchObject({ code: 'telegram_http_401' })
    const notOk = new BotApiTelegramSender({ token: 'secret-token', chatId: '1', fetchImpl: (async () => new Response(JSON.stringify({ ok: false }), { status: 200 })) as never })
    await expect(notOk.send('x')).rejects.toMatchObject({ code: 'telegram_rejected' })
  })
  it('reads the deploy/alerts.py variables: none is no channel, one alone is an error', () => {
    expect(telegramSenderFromEnv({})).toBeNull()
    expect(telegramSenderFromEnv({ LIWAN_ALERT_TELEGRAM_BOT_TOKEN: 't', LIWAN_ALERT_TELEGRAM_CHAT_ID: '1' })).toBeInstanceOf(BotApiTelegramSender)
    expect(() => telegramSenderFromEnv({ LIWAN_ALERT_TELEGRAM_BOT_TOKEN: 't' })).toThrow('telegram_not_configured')
  })
})
