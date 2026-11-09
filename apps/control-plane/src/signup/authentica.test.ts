import { describe, expect, it, vi } from 'vitest'
import { AuthenticaSmsAdapter } from './authentica.js'

const apiKey = 'fixture-api-key'
const mobile = '+966500000000'
const code = '012345'
const deliveryError = 'Unable to send verification SMS'

describe('AuthenticaSmsAdapter', () => {
  it('submits the supplied code as an SMS and accepts the provider acknowledgment', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      success: true,
      data: null,
      message: 'OTP send successfully',
    }))
    await expect(new AuthenticaSmsAdapter(apiKey, 42, fetcher).send(mobile, code)).resolves.toBeUndefined()

    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.authentica.sa/api/v2/send-otp', {
      method: 'POST',
      headers: {
        'X-Authorization': apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      redirect: 'error',
      signal: expect.any(AbortSignal),
      body: expect.any(String),
    })
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      method: 'sms',
      phone: mobile,
      otp: code,
      template_id: 42,
    })
  })

  it.each([
    ['HTTP rejection', 429, JSON.stringify({ success: true })],
    ['redirect', 307, JSON.stringify({ success: true })],
    ['provider rejection', 200, JSON.stringify({ success: false, message: `${mobile} ${code} ${apiKey}` })],
    ['missing success flag', 200, '{}'],
    ['non-boolean success flag', 200, '{"success":"true"}'],
    ['invalid JSON', 200, `not JSON ${mobile} ${code} ${apiKey}`],
  ])('reports a fixed error for %s', async (_reason, status, body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }))
    await expect(new AuthenticaSmsAdapter(apiKey, 42, fetcher).send(mobile, code))
      .rejects.toHaveProperty('message', deliveryError)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('aborts when the response body stalls after the headers arrive', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Response(new ReadableStream({
        start(controller) {
          init!.signal!.addEventListener('abort', () => controller.error(new Error('Network request aborted')))
        },
      })))
      const result = new AuthenticaSmsAdapter(apiKey, 42, fetcher).send(mobile, code)
      const rejection = expect(result).rejects.toHaveProperty('message', deliveryError)
      await vi.advanceTimersByTimeAsync(8_000)
      await rejection
      expect(fetcher.mock.calls[0]![1]!.signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
