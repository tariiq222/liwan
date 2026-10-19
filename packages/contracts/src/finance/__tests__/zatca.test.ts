import { describe, expect, it } from 'vitest'
import {
  FinanceZatcaErrorCodeSchema,
  FinanceZatcaOnboardInputSchema,
  FinanceZatcaSubmissionSchema,
} from '..'

const SUBMISSION = {
  state: 'rejected',
  mode: 'reporting',
  errors: [{ code: 'BR-KSA-F-06-C01', message: 'The invoice type code is not valid' }],
  warnings: [],
  qr_present: false,
}

describe('finance ZATCA contracts', () => {
  it('accepts a submission state with ZATCA messages, coded or not', () => {
    expect(FinanceZatcaSubmissionSchema.parse(SUBMISSION)).toEqual(SUBMISSION)
    const retry = { ...SUBMISSION, state: 'retry', errors: [{ code: null, message: 'retry later' }] }
    expect(FinanceZatcaSubmissionSchema.parse(retry)).toEqual(retry)
    for (const state of ['blocked', 'unauthorized']) {
      const local = { ...SUBMISSION, state, errors: [{ code: null, message: 'local' }] }
      expect(FinanceZatcaSubmissionSchema.parse(local)).toEqual(local)
    }
    const none = { state: 'not_applicable', mode: null, errors: [], warnings: [], qr_present: false }
    expect(FinanceZatcaSubmissionSchema.parse(none)).toEqual(none)
  })

  it('refuses an unknown state, a stray key and a secret smuggled into the submission', () => {
    expect(() => FinanceZatcaSubmissionSchema.parse({ ...SUBMISSION, state: 'sent' })).toThrow()
    expect(() => FinanceZatcaSubmissionSchema.parse({ ...SUBMISSION, mode: 'prod' })).toThrow()
    expect(() => FinanceZatcaSubmissionSchema.parse({ ...SUBMISSION, csid: 'x' })).toThrow()
    expect(() => FinanceZatcaSubmissionSchema.parse({ ...SUBMISSION, errors: [{ code: null, message: 'x', raw: 1 }] })).toThrow()
  })

  it('validates the onboarding body: a six-digit OTP and nothing else', () => {
    expect(FinanceZatcaOnboardInputSchema.parse({ otp: '123345' })).toEqual({ otp: '123345' })
    expect(() => FinanceZatcaOnboardInputSchema.parse({ otp: '12345' })).toThrow()
    expect(() => FinanceZatcaOnboardInputSchema.parse({ otp: 123345 })).toThrow()
    expect(() => FinanceZatcaOnboardInputSchema.parse({ otp: '123345', mode: 'prod' })).toThrow()
    expect(() => FinanceZatcaOnboardInputSchema.parse({})).toThrow()
  })

  it('names the stable ZATCA error codes', () => {
    expect(FinanceZatcaErrorCodeSchema.options).toContain('zatca_unavailable')
    expect(() => FinanceZatcaErrorCodeSchema.parse('zatca_made_up')).toThrow()
  })
})
