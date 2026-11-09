import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Pool } from 'pg'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import { consumeNonce, type CustomerInput } from '../commercial/customer-http.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { parseBody } from '../commercial/http.js'
import { mailAdapterFromEnv } from '../commercial/mail-adapter.js'
import { transaction } from '../db.js'
import { AuthenticaSmsAdapter } from './authentica.js'
import { SignupService, signupInput } from './service.js'

export const isSignupEndpoint = (pathname: string) => pathname.startsWith('/v1/customer/signup/')
const requestPath = /^\/v1\/customer\/signup\/(start|verify-sms|send-email|verify-email)$/
const challenge = z.strictObject({ signup_id: z.uuid() })
const verification = challenge.extend({ code: z.string().regex(/^[0-9]{6}$/) })

export function signupFromEnv(pool: Pool, secret: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (env.LIWAN_PUBLIC_SIGNUP !== 'true' || env.LIWAN_TENANCY_MODE !== 'shared') return
  const plan = z.uuid().safeParse(env.LIWAN_SIGNUP_PLAN_REVISION_ID)
  const key = env.LIWAN_SIGNUP_AUTHENTICA_KEY
  const template = Number(env.LIWAN_SIGNUP_AUTHENTICA_TEMPLATE_ID)
  const dailyLimit = Number(env.LIWAN_SIGNUP_DAILY_LIMIT ?? 100)
  if (!secret || secret.length < 32 || !plan.success || !key?.trim() || !Number.isSafeInteger(template) || template < 1 ||
      !Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 10_000) throw new Error('signup_configuration_invalid')
  const sms = new AuthenticaSmsAdapter(key, template)
  if (env.LIWAN_MAIL_MODE === 'disabled') throw new Error('signup_email_unavailable')
  const mail = mailAdapterFromEnv(env, 8_000)
  return new SignupService(pool, { secret, planId: plan.data, dailyLimit,
    sms: (mobile, code) => sms.send(mobile, code),
    email: async (email, code) => {
      const result = await mail.send({
        to: email, message_id: randomUUID(), subject: 'ليوان | رمز تأكيد البريد',
        text: `رمز تأكيد البريد للتسجيل في ليوان: ${code}\nLiwan signup verification code: ${code}\n\nصالح لمدة خمس دقائق. Valid for five minutes.`,
      })
      if (!result.accepted) throw new Error('signup_email_unavailable')
    },
  })
}

export async function signupHttp(pool: Pool, config: { issuer?: string; key?: string }, input: CustomerInput, service?: SignupService) {
  const match = requestPath.exec(input.path)
  if (!match || input.method !== 'POST' || !service || !config.issuer || !config.key) throw new CommercialHttpError('not_found', 404)
  const ip = input.headers['x-liwan-signup-client']
  if (typeof ip !== 'string' || !isIP(ip)) throw new CommercialHttpError('unauthorized', 401)
  if (Buffer.byteLength(input.raw) > 2048) throw new CommercialHttpError('invalid', 413)
  const signed = verifyServiceRequest({
    method: input.method, path: input.path, body: `liwan-signup:${ip}\n${input.raw}`, headers: input.headers, key: config.key, anonymous: true,
  })
  if (!signed || signed.issuer !== config.issuer) throw new CommercialHttpError('unauthorized', 401)
  await transaction(pool, client => consumeNonce(client, signed))
  if (match[1] === 'start') return { status: 201, data: await service.start(parseBody(input.raw, signupInput), ip) }
  if (match[1] === 'send-email') {
    const { signup_id } = parseBody(input.raw, challenge)
    return { status: 200, data: await service.sendEmail(signup_id, ip) }
  }
  const { signup_id, code } = parseBody(input.raw, verification)
  const data = match[1] === 'verify-sms' ? await service.verifySms(signup_id, code) : await service.verifyEmail(signup_id, code)
  return { status: 200, data }
}
