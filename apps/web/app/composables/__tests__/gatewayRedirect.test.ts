import { afterEach, describe, expect, it, vi } from 'vitest'
import { leaveForGateway } from '../gatewayRedirect'

const LINK = { kind: 'order', id: 42, token: 'tok-42' } as const

interface FakeElement { tag: string; [key: string]: unknown }

// A page that records what the browser is asked to do, in order.
function fakePage(protocol = 'https:') {
  const calls: string[] = []
  const appended: FakeElement[] = []
  const submitted: FakeElement[] = []
  const document = {
    set cookie(value: string) { calls.push(`cookie ${value}`) },
    createElement: (tag: string): FakeElement => {
      const element: FakeElement = { tag, children: [] as FakeElement[], append(child: FakeElement) { (element.children as FakeElement[]).push(child) } }
      if (tag === 'form') element.submit = () => { calls.push('submit'); submitted.push(element) }
      return element
    },
    body: { append: (element: FakeElement) => { calls.push('append'); appended.push(element) } },
  }
  const location = { protocol, assign: (url: string) => calls.push(`assign ${url}`) }
  vi.stubGlobal('document', document)
  vi.stubGlobal('location', location)
  return { calls, appended, submitted }
}

afterEach(() => vi.unstubAllGlobals())

describe('leaveForGateway', () => {
  it('writes the return cookie first, then navigates for a get redirect with the fields as query', () => {
    const page = fakePage()
    leaveForGateway(LINK, { method: 'get', url: 'https://pay.example/checkout', fields: { payment_token: 'pt_1' } })
    expect(page.calls).toEqual([
      'cookie webvue_pay_return=order.42.tok-42; Path=/payment; Max-Age=3600; SameSite=Lax; Secure',
      'assign https://pay.example/checkout?payment_token=pt_1',
    ])
  })

  it('does not mark the cookie Secure on a plain http page', () => {
    const page = fakePage('http:')
    leaveForGateway(LINK, { method: 'get', url: 'https://pay.example/checkout', fields: {} })
    expect(page.calls[0]).not.toContain('Secure')
  })

  it('writes the cookie, then submits a hidden form with one hidden input per field for a post redirect', () => {
    const page = fakePage()
    leaveForGateway(LINK, { method: 'post', url: 'https://pay.example/checkout', fields: { payment_token: 'pt_1', reference: 'INV/1' } })
    expect(page.calls.map(call => call.split(' ')[0])).toEqual(['cookie', 'append', 'submit'])
    const [form] = page.submitted
    expect(form).toMatchObject({ method: 'post', action: 'https://pay.example/checkout', hidden: true })
    expect((form!.children as FakeElement[]).map(({ type, name, value }) => ({ type, name, value }))).toEqual([
      { type: 'hidden', name: 'payment_token', value: 'pt_1' },
      { type: 'hidden', name: 'reference', value: 'INV/1' },
    ])
  })

  it('refuses a gateway address that is not a web page before it stores or sends anything', () => {
    const page = fakePage()
    expect(() => leaveForGateway(LINK, { method: 'get', url: 'javascript:alert(1)', fields: {} })).toThrow('web address')
    expect(() => leaveForGateway(LINK, { method: 'post', url: 'data:text/html,x', fields: {} })).toThrow('web address')
    expect(page.calls).toEqual([])
  })
})
