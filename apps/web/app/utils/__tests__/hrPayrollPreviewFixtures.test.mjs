import { describe, expect, it } from 'vitest'
import { HrMyPayslipListSchema, HrMyPayslipSchema, HrPayslipSchema } from '@liwan/contracts'
import { hrPayrollPreviewData } from '../../../e2e/hr-payroll-ui-preview-data.mjs'

// The synthetic payroll API the mocked Playwright specs drive. Its two payslip documents are parsed here with the
// same strict schemas the app uses, so a shape change that would break the page fails without a running server.
const at = path => new URL(`http://localhost${path}`)

const ownPayslipId = () => {
  const list = hrPayrollPreviewData('/api/v1/hr/payroll/payslips/mine', at('/api/v1/hr/payroll/payslips/mine'))
  return HrMyPayslipListSchema.parse(list).items[0].id
}

describe('the payroll preview fixtures', () => {
  it('serves the own payslip with the self-service shape and without the employer figures', () => {
    const path = `/api/v1/hr/payroll/payslips/mine/${ownPayslipId()}`
    const own = hrPayrollPreviewData(path, at(path))
    expect(() => HrMyPayslipSchema.parse(own)).not.toThrow()
    // The payroll-area shape requires the employer share and the tax number, so it must refuse this body.
    expect(HrPayslipSchema.safeParse(own).success).toBe(false)
    expect(own).not.toHaveProperty('gosi_employer')
    expect(own.company).not.toHaveProperty('vat')
  })

  it('serves the run payslip with the payroll-area shape', () => {
    const path = '/api/v1/hr/payroll/runs/1/payslips/11'
    const slip = hrPayrollPreviewData(path, at(path))
    expect(() => HrPayslipSchema.parse(slip)).not.toThrow()
    expect(slip.gosi_employer).toEqual(expect.any(Number))
    expect(slip.company.vat).toEqual(expect.any(String))
  })
})
