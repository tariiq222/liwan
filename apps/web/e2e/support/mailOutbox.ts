import { readFileSync } from 'node:fs'
import { expect, type APIRequestContext } from '@playwright/test'

// An invited account has no password until its holder opens the emailed link, so the journeys that sign an invited user in
// read that link from a capture of the outgoing mail: a JSON-lines file (`{"to": "...", "text": "..."}`) the isolated runner
// points Odoo's outgoing mail at. Without it those journeys skip; the invitation journeys themselves need no mail.
export const MAIL_OUTBOX = process.env.E2E_MAIL_OUTBOX
export const NEEDS_MAIL = 'Needs E2E_MAIL_OUTBOX: the emailed invitation link sets the password'
let nextMobile = 0

function linkToken(login: string): string {
  const mails = readFileSync(MAIL_OUTBOX!, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { to: string; text: string })
  const mail = mails.reverse().find((item) => item.to.includes(login))
  const token = mail && /token=([\w-]+)/.exec(mail.text)?.[1]
  expect(token, `no emailed link for ${login} in ${MAIL_OUTBOX}`).toBeTruthy()
  return token!
}

/** The invitee's side of the latest emailed link: sets a number and PASSWORD through the public accept route. */
export async function acceptInvitation(request: APIRequestContext, login: string, password: string) {
  nextMobile += 1
  const mobile = `+9665${String((Date.now() + nextMobile) % 100_000_000).padStart(8, '0')}`
  const response = await request.post('/api/v1/public/account/invitation/accept', { data: { token: linkToken(login), mobile, password } })
  expect(response.ok(), `accept ${login}: ${response.status()} ${await response.text()}`).toBeTruthy()
}
