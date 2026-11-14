import { describe, expect, it } from 'vitest'
import { customerRoute } from '../customer-commercial'

describe('the customer cancellation routes', () => {
  it('forward cancel and resume to the control plane for a subscription manager only', () => {
    expect(customerRoute('POST', 'subscription/cancel')).toEqual({ upstream: '/v1/customer/subscription/cancel', needs: 'subscription.manage' })
    expect(customerRoute('POST', 'subscription/resume')).toEqual({ upstream: '/v1/customer/subscription/resume', needs: 'subscription.manage' })
  })
  it('open no other method or path under subscription', () => {
    expect(customerRoute('GET', 'subscription/cancel')).toBeNull()
    expect(customerRoute('DELETE', 'subscription/cancel')).toBeNull()
    expect(customerRoute('POST', 'subscription/other')).toBeNull()
    expect(customerRoute('POST', 'subscription/cancel/extra')).toBeNull()
  })
})
