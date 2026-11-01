import { describe, expect, it } from 'vitest'
import { HrLeaveApprovalProcessSchema, HrLeaveApprovalSchema } from '..'

const REVIEWER = { id: 3, name: 'Noura', user_id: 12 }

describe('HrLeaveApprovalSchema', () => {
  it('accepts a request with a decided and a waiting stage', () => {
    const parsed = HrLeaveApprovalSchema.parse({
      request_id: 9,
      state: 'pending',
      href: '/operations/9',
      steps: [
        { sequence: 1, name: 'Direct manager', reviewers: [REVIEWER], status: 'approved' },
        { sequence: 2, name: 'HR', reviewers: [REVIEWER], status: 'pending' },
      ],
    })
    expect(parsed.steps.map(step => step.status)).toEqual(['approved', 'pending'])
  })

  it('rejects an unknown request state', () => {
    expect(() => HrLeaveApprovalSchema.parse({ request_id: 9, state: 'open', href: '/operations/9', steps: [] })).toThrow()
  })
})

describe('HrLeaveApprovalProcessSchema', () => {
  it('accepts the answer without a governing process', () => {
    const parsed = HrLeaveApprovalProcessSchema.parse({ process: null, href: '/settings/apps/operations/processes/new', can_manage: false })
    expect(parsed.process).toBeNull()
  })

  it('accepts resolver and named stages', () => {
    const parsed = HrLeaveApprovalProcessSchema.parse({
      process: {
        id: 4,
        name: 'Leave approval',
        revision: 2,
        steps: [
          { name: 'Direct manager', resolver: 'hr_leave_approver', resolver_label: 'Direct manager', reviewers: [] },
          { name: 'Named', resolver: null, resolver_label: null, reviewers: [REVIEWER] },
        ],
      },
      href: '/settings/apps/operations/processes/4',
      can_manage: true,
    })
    expect(parsed.process?.steps[1]?.reviewers).toHaveLength(1)
  })
})
