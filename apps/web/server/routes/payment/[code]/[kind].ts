import { createError, deleteCookie, getCookie, getRouterParam, sendRedirect, sendWebResponse, setResponseHeader } from 'h3'
import { decodePayReturn, PAY_RETURN_COOKIE, PAY_RETURN_COOKIE_PATH } from '@webvue/contracts'
import { boundedTenantBody, withTenantBody, withTenantResponse } from '../../../utils/tenantTransport'
import { forwardPublicApi } from '../../../utils/publicApi'

// Gateways call the stock Odoo callback paths on the tenant's host (`/payment/<code>/webhook`,
// `/payment/<code>/return`). The edge sends them here, and they are relayed unchanged (method,
// query, body, content type) to the one Odoo dispatch route, which hands them to the stock
// provider controller. No guard layer opens a /payment path of its own.
const CODE = /^[a-z][a-z0-9_]{0,31}$/
// Returns are GET navigations: a cross-site POST would not carry the SameSite=Lax return cookie, and
// the internal hop to Odoo accepts JSON bodies only. A gateway that returns by POST needs its own decision.
const METHODS: Record<string, readonly string[]> = { webhook: ['POST'], return: ['GET'] }
const MAX_CALLBACK_BODY = 64 * 1024

const notFound = () => createError({ statusCode: 404, data: { code: 'not_found', message: 'Not found' } })

export default defineEventHandler(async (event) => {
  const { odooUrl } = useRuntimeConfig(event)
  const code = getRouterParam(event, 'code') ?? ''
  const kind = getRouterParam(event, 'kind') ?? ''
  const methods = METHODS[kind]
  if (!CODE.test(code) || !methods) throw notFound()
  if (!methods.includes(event.method)) {
    setResponseHeader(event, 'allow', methods.join(', '))
    throw createError({ statusCode: 405, data: { code: 'method_not_allowed', message: 'This endpoint does not support the request method.' } })
  }
  const queryAt = event.path.indexOf('?')
  const path = `/api/v1/public/payments/hooks/${code}/${kind}${queryAt < 0 ? '' : event.path.slice(queryAt)}`
  return withTenantBody(event, 'public', async () => {
    const body = await boundedTenantBody(event, MAX_CALLBACK_BODY)
    return withTenantResponse(event, 'public', async () => {
      const response = await forwardPublicApi(event, odooUrl, path, { method: event.method, body })
      if (kind === 'webhook') return sendWebResponse(event, response)
      await response.body?.cancel()
      // The payer is back from the gateway page, whatever Odoo made of the return (a refused return
      // changes nothing): send them to the status page of the invoice they were paying, which reads
      // the real state from the server. The pay page remembered the invoice before leaving.
      const back = decodePayReturn(getCookie(event, PAY_RETURN_COOKIE))
      deleteCookie(event, PAY_RETURN_COOKIE, { path: PAY_RETURN_COOKIE_PATH })
      const target = back
        ? `/pay/invoice/${back.invoiceId}/status?access_token=${encodeURIComponent(back.accessToken)}`
        : '/pay/returned'
      return sendRedirect(event, target, 303)
    })
  })
})
