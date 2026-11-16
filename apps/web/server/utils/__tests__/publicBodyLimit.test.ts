import { expect, it } from 'vitest'
import { MAX_PUBLIC_API_BODY, MAX_PUBLIC_SALES_BODY, publicBodyLimit } from '../publicApi'
import { MAX_PUBLIC_HOOK_BODY, MAX_PUBLIC_MFA_BODY } from '../tenantTransport'

// The quotation answer carries a drawn signature, so only the quotation routes take more than the form size.
it('lets the public quotation routes take a signature and every other public route only a form', () => {
  expect(MAX_PUBLIC_API_BODY).toBe(16 * 1024)
  expect(MAX_PUBLIC_SALES_BODY).toBe(96 * 1024)
  // A 48 KB PNG is 64 KB once base64 encoded, so the larger cap fits it with the rest of the body and the smaller does not.
  expect(Math.ceil(48 * 1024 / 3) * 4).toBeLessThan(MAX_PUBLIC_SALES_BODY)
  expect(Math.ceil(48 * 1024 / 3) * 4).toBeGreaterThan(MAX_PUBLIC_API_BODY)
  for (const action of ['accept', 'decline']) expect(publicBodyLimit(`/api/v1/public/sales/quotations/7/${action}`)).toBe(MAX_PUBLIC_SALES_BODY)
  expect(publicBodyLimit('/api/v1/public/payments/invoices/7/transactions')).toBe(MAX_PUBLIC_API_BODY)
  expect(publicBodyLimit('/api/v1/public/appointments/bookings/7/schedule')).toBe(MAX_PUBLIC_API_BODY)
})

it('keeps the exact limits of the sign-in steps and the provider hooks, and no cap outside the public namespace', () => {
  expect(publicBodyLimit('/api/v1/auth/verify')).toBe(MAX_PUBLIC_MFA_BODY)
  expect(publicBodyLimit('/api/v1/inbox/hooks/whatsapp')).toBe(MAX_PUBLIC_HOOK_BODY)
  expect(publicBodyLimit('/api/v1/sales/orders/7/send')).toBeUndefined()
  expect(publicBodyLimit('/api/v1/sales/quotations')).toBeUndefined()
})
