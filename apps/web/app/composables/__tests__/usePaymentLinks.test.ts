import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../useApi'
import { usePaymentLinkAction } from '../usePaymentLinks'

const mocks = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), writeText: vi.fn(), can: vi.fn() }))
vi.mock('@tanstack/vue-query', async original => ({
  ...await original<object>(),
  useMutation: (options: { mutationFn: (input: number) => Promise<unknown> }) => ({ mutateAsync: options.mutationFn, isPending: ref(false) }),
}))

const OWING = { id: 2, move_type: 'out_invoice', state: 'posted', payment_state: 'not_paid', amount_residual: 1380 } as const
const MESSAGES: Record<string, string> = {
  'payments.link.copied': 'تم نسخ رابط الدفع',
  'payments.link.copiedHint': 'أرسله إلى العميل',
  'payments.link.copyFailed': 'تعذّر النسخ',
  'payments.link.failed': 'تعذّر إنشاء رابط الدفع',
  'payments.link.errors.notPayable': 'لا تقبل الدفع بالرابط',
  'payments.link.errors.noGateway': 'لا توجد بوابة',
  'errors.generic': 'حدث خطأ',
}

function setup(invoice: unknown = OWING, capable = true) {
  mocks.can.mockImplementation((capability: string) => capable && capability === 'payments.links.manage')
  vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => MESSAGES[key] ?? key }))
  vi.stubGlobal('useToast', () => ({ add: mocks.toast }))
  vi.stubGlobal('useAccess', () => ({ can: mocks.can }))
  vi.stubGlobal('window', { location: { origin: 'https://acme.webvue.example' } })
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.writeText } })
  return usePaymentLinkAction(() => invoice as never)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('usePaymentLinkAction', () => {
  it('is offered to a holder of payments.links.manage for a customer invoice still owing', () => {
    expect(setup().offered.value).toBe(true)
  })

  it('is not offered without the capability, nor for an invoice that cannot be paid', () => {
    expect(setup(OWING, false).offered.value).toBe(false)
    expect(setup({ ...OWING, payment_state: 'paid', amount_residual: 0 }).offered.value).toBe(false)
    expect(setup(null).offered.value).toBe(false)
  })

  it('creates the link for the invoice, copies its address on the browser\'s own origin and says so', async () => {
    const action = setup()
    mocks.api.mockResolvedValue({ path: '/pay/invoice/2?access_token=tok-2' })
    await action.copyLink()
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/payments/links', expect.objectContaining({ method: 'POST', body: { invoice_id: 2 }, schema: expect.anything() }))
    expect(mocks.writeText).toHaveBeenCalledWith('https://acme.webvue.example/pay/invoice/2?access_token=tok-2')
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'تم نسخ رابط الدفع', description: 'أرسله إلى العميل', color: 'success' })
  })

  it('shows the link to copy by hand, and keeps it on screen, when the browser refuses the clipboard', async () => {
    const action = setup()
    mocks.api.mockResolvedValue({ path: '/pay/invoice/2?access_token=tok-2' })
    mocks.writeText.mockRejectedValue(new Error('denied'))
    await action.copyLink()
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'تعذّر النسخ', description: 'https://acme.webvue.example/pay/invoice/2?access_token=tok-2', color: 'warning', duration: 0 })
  })

  it.each([
    ['not_payable', 409, 'لا تقبل الدفع بالرابط'],
    ['no_gateway', 422, 'لا توجد بوابة'],
  ])('words the %s refusal in the user\'s language and copies nothing', async (code, status, text) => {
    const action = setup()
    mocks.api.mockRejectedValue(new ApiError(status, code, 'server text'))
    await action.copyLink()
    expect(mocks.writeText).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'تعذّر إنشاء رابط الدفع', description: text, color: 'error' })
  })

  it('shows the API\'s own text for a refusal it does not word, and a generic one for a failure that is no API answer', async () => {
    const action = setup()
    mocks.api.mockRejectedValueOnce(new ApiError(403, 'forbidden', 'ليس لديك صلاحية'))
    await action.copyLink()
    expect(mocks.toast).toHaveBeenLastCalledWith({ title: 'تعذّر إنشاء رابط الدفع', description: 'ليس لديك صلاحية', color: 'error' })
    mocks.api.mockRejectedValueOnce(new Error('offline'))
    await action.copyLink()
    expect(mocks.toast).toHaveBeenLastCalledWith({ title: 'تعذّر إنشاء رابط الدفع', description: 'حدث خطأ', color: 'error' })
  })
})
