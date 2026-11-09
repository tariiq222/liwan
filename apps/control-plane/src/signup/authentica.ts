const SMS_ENDPOINT = 'https://api.authentica.sa/api/v2/send-otp'
const SMS_TIMEOUT_MS = 8_000
const SMS_ERROR = 'Unable to send verification SMS'

export class AuthenticaSmsAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly templateId: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(mobile: string, code: string): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), SMS_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(SMS_ENDPOINT, {
        method: 'POST',
        headers: {
          'X-Authorization': this.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          method: 'sms',
          phone: mobile,
          otp: code,
          template_id: this.templateId,
        }),
        redirect: 'error',
        signal: controller.signal,
      })
      if (response.ok) {
        const acknowledgment = await response.json() as { success?: unknown } | null
        if (acknowledgment?.success === true) return
      }
    } catch {
      // Network and parse errors may contain credentials or recipient data.
      throw new Error(SMS_ERROR)
    } finally {
      clearTimeout(timeout)
    }
    throw new Error(SMS_ERROR)
  }
}
