import { gatewayUrl, payReturnCookie, redirectUrl, type GatewayRedirect, type PayLink } from './paymentPay'

/**
 * Takes the payer to the gateway page. The return cookie is written first: the gateway sends the payer back
 * to `/payment/<code>/return` (never to this page), and that route reads the cookie to find the status page of the invoice or order.
 * `get` navigates with the fields as query; `post` submits them as a hidden form. Browser only.
 */
export function leaveForGateway(link: PayLink, redirect: GatewayRedirect): void {
  // Validate before anything is stored or sent.
  const target = redirect.method === 'get' ? redirectUrl(redirect) : gatewayUrl(redirect).toString()
  document.cookie = payReturnCookie(link, location.protocol === 'https:')
  if (redirect.method === 'get') {
    location.assign(target)
    return
  }
  const form = document.createElement('form')
  form.method = 'post'
  form.action = target
  form.hidden = true
  for (const [name, value] of Object.entries(redirect.fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.append(input)
  }
  document.body.append(form)
  form.submit()
}
