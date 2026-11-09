import { readFileSync } from 'node:fs'
import { expect, type APIRequestContext } from '@playwright/test'

// An invited account has no password until its holder opens the emailed link, so the journeys that sign an invited user in
// read that link from a capture of the outgoing mail: a JSON-lines file (`{"to": "...", "text": "..."}`) the isolated runner
// points Odoo's outgoing mail at. Without it those journeys skip; the invitation journeys themselves need no mail.
export const MAIL_OUTBOX = process.env.E2E_MAIL_OUTBOX
export const NEEDS_MAIL = 'Needs E2E_MAIL_OUTBOX: the emailed invitation link sets the password'
let nextMobile = 0

interface CapturedMail { to: string, text: string }

/** The message a raw MIME body carries in every part: headers dropped, and the base64 or quoted-printable text decoded.
 *
 * A capture holds the delivered bytes, so what the recipient reads is inside a MIME part, not the file itself: Odoo
 * encodes the Arabic body, and a link or a code is only findable after the transfer encoding is undone.
 */
function decodedBody(raw: string): string {
  // A multipart body repeats `--<boundary>` before each part and closes with `--<boundary>--`; the headers of each
  // part end at the first blank line.
  const parts = raw.split(/^-{2}=+/m)
  const decoded = parts.map((part) => {
    const [, body = ''] = part.split(/\r?\n\r?\n/)
    const text = body.replace(/^--.*$/gm, '').trim()
    if (/content-transfer-encoding:\s*base64/i.test(part)) return Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8')
    if (/content-transfer-encoding:\s*quoted-printable/i.test(part)) {
      return Buffer.from(text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))), 'binary').toString('utf8')
    }
    return text
  })
  // The raw body is included too: an unframed capture (a plain text file) has no parts, and its own text is the answer.
  return [...decoded, raw].join('\n')
}

/** Every captured message to LOGIN that carries what MATCH looks for, newest first.
 *
 * The delivery runs on a daemon thread after the request commits (`liwan.outbound.mail._liwan_send_after_commit`), so
 * the capture can still be empty the instant the inviting request returns: poll the file for a bounded window instead
 * of reporting a missing link the product only just sent.
 */
async function messagesFor(login: string, match: RegExp, timeoutMs = 15_000): Promise<Array<{ body: string, found: RegExpExecArray }>> {
  const read = () => {
    const mails = readFileSync(MAIL_OUTBOX!, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CapturedMail)
      .filter((mail) => mail.to.includes(login))
    const found: Array<{ body: string, found: RegExpExecArray }> = []
    for (const mail of mails.reverse()) {
      const body = decodedBody(mail.text)
      const hit = match.exec(body)
      match.lastIndex = 0
      if (hit) found.push({ body, found: hit })
    }
    return found
  }
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = read()
    if (found.length || Date.now() > deadline) return found
    await new Promise(done => setTimeout(done, 250))
  }
}

async function linkToken(login: string): Promise<string> {
  const [message] = await messagesFor(login, /token=([\w-]+)/)
  expect(message?.found[1], `no emailed invitation link for ${login} in ${MAIL_OUTBOX}`).toBeTruthy()
  return message!.found[1]!
}

/** The invitee's side of the latest emailed link: sets a number and PASSWORD through the public accept route. */
export async function acceptInvitation(request: APIRequestContext, login: string, password: string) {
  const token = await linkToken(login)
  nextMobile += 1
  const mobile = `+9665${String((Date.now() + nextMobile) % 100_000_000).padStart(8, '0')}`
  const response = await request.post('/api/v1/public/account/invitation/accept', { data: { token, mobile, password } })
  expect(response.ok(), `accept ${login}: ${response.status()} ${await response.text()}`).toBeTruthy()
}

/** The newest six-digit sign-in code sent to LOGIN: it exists in the message, the table stores only its hash. */
export async function signInCode(login: string): Promise<string> {
  const [message] = await messagesFor(login, /(?:ليوان|LiwanOS)[^\d\n]{0,40}(\d{6})/)
  expect(message?.found[1], `no emailed sign-in code for ${login} in ${MAIL_OUTBOX}`).toBeTruthy()
  return message!.found[1]!
}
