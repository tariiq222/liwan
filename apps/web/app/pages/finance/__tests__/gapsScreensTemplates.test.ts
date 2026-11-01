import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '../../../modules/finance/manifest'

// The internal transfer panel, a partner's bank accounts, the asset profile of a bill line and the exchange difference of a
// payment stay on their templates and behind their capabilities. This is a source guard, not a behaviour test.
const app = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the internal transfer is a route-backed panel over the payments list', () => {
  it('opens in the shared create panel behind the manage capability, never in a dialog', () => {
    const page = read('pages/finance/payments/transfer/new.vue')
    for (const needle of ['<SharedCreatePanel', '<PaymentList background', '<TransferForm', 'page.allowed', '<SharedForbiddenState']) expect(page, needle).toContain(needle)
    expect(page).not.toContain('SharedModal')
    expect(read('components/finance/payments/usePaymentCreatePage.ts')).toContain("can('finance.payments.manage')")
    expect(read('components/finance/payments/PaymentList.vue')).toContain("can('finance.payments.manage') && !props.background ? transferPaymentLink")
  })

  it('is guarded by the manifest like the other payment write routes', () => {
    const rule = manifest.routeCapabilities?.find(item => item.pattern.test('/finance/payments/transfer/new'))
    expect(rule?.capability).toBe('finance.payments.manage')
  })

  it('shows both resulting payments and links the missing transfer account to the finance setup', () => {
    const form = read('components/finance/payments/TransferForm.vue')
    for (const needle of ['`finance-transfer-${leg.key}`', "key: 'outbound'", "key: 'inbound'", 'TRANSFER_ACCOUNT_SETUP_PATH', "can('finance.setup.manage')", 'useCreateFinanceTransfer', 'transferErrorKey']) expect(form, needle).toContain(needle)
  })
})

describe('the partner page lists bank accounts', () => {
  it('reads them for partners.read and edits only for partners.manage, with an inline confirmation to archive', () => {
    expect(read('pages/finance/partners/[partnerId].vue')).toContain(`<PartnerBankAccounts v-if="partner && can('finance.partners.read')"`)
    expect(read('pages/finance/partners/[partnerId].vue')).toContain(`:can-manage="can('finance.partners.manage')"`)
    const section = read('components/finance/PartnerBankAccounts.vue')
    for (const needle of ['<SharedRecordSection', '<SharedInlineConfirm', 'v-if="canManage"', '<PartnerBankForm']) expect(section, needle).toContain(needle)
    expect(section).not.toContain('SharedModal')
  })
})

describe('the invoice and payment screens show the asset and the exchange difference', () => {
  it('offers the asset profile on bill lines to asset managers and links the created asset', () => {
    const form = read('components/finance/invoices/InvoiceForm.vue')
    for (const needle of ["offersAssetProfile(props.moveType, can('finance.assets.manage'))", 'useFinanceAssetProfiles(showAssetProfile)', 'v-if="showAssetProfile"']) expect(form, needle).toContain(needle)
    expect(read('components/finance/invoices/InvoiceLinesPanel.vue')).toContain('`/finance/assets/${row.original.asset.id}`')
  })

  it('shows the exchange difference of a payment on the list rows', () => {
    const list = read('components/finance/payments/PaymentList.vue')
    expect(list.match(/<PaymentExchangeDifference/g)).toHaveLength(2)
  })
})
