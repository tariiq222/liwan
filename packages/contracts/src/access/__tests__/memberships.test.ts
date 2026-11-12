import { describe, expect, it } from 'vitest'
import {
  AuditActionSchema,
  ExistingAccountDetailsSchema,
  MembershipBranchListSchema,
  MembershipBranchSchema,
  MembershipInputSchema,
  MembershipListSchema,
  MembershipQuerySchema,
  MembershipRolesInputSchema,
  MembershipSchema,
} from '..'

const company = { id: 3, name: 'Branch B' }
const home = { id: 2, name: 'Branch A' }
const assignment = {
  id: 9,
  role: { id: 5, key: 'employee', name: { ar: 'موظف', en: 'Employee' }, type: 'built_in', protected: false },
  scope: { kind: 'company', id: 3, name: 'Branch B' },
}
const member = { id: 7, name: 'Sara', login: 'sara@example.com', home_company: home, company, assignments: [assignment], version: 'm3-u7-r5' }
const grant = { role_id: 5, scope: { kind: 'company', id: 3 } }

describe('membership shapes', () => {
  it('parses a member with and without roles in the company', () => {
    expect(MembershipSchema.parse(member)).toEqual(member)
    expect(MembershipSchema.parse({ ...member, assignments: [] }).assignments).toEqual([])
    expect(MembershipListSchema.parse({ items: [member], total: 1 }).total).toBe(1)
  })

  it('is strict about every field the server does not send', () => {
    expect(() => MembershipSchema.parse({ ...member, active: true })).toThrow()
    expect(() => MembershipSchema.parse({ ...member, version: '' })).toThrow()
    expect(() => MembershipSchema.parse({ ...member, home_company: { ...home, extra: 1 } })).toThrow()
    expect(() => MembershipSchema.parse({ id: 7 })).toThrow()
    expect(() => MembershipListSchema.parse({ items: [member], total: 1, version: 'x' })).toThrow()
  })
})

describe('membership branches', () => {
  it('lists the branches below the root by id and name with the full count', () => {
    expect(MembershipBranchSchema.parse(company)).toEqual(company)
    expect(MembershipBranchListSchema.parse({ items: [company, home], total: 5 })).toEqual({ items: [company, home], total: 5 })
    expect(MembershipBranchListSchema.parse({ items: [], total: 0 }).items).toEqual([])
  })

  it('is strict about every field the server does not send', () => {
    expect(() => MembershipBranchSchema.parse({ ...company, active: true })).toThrow()
    expect(() => MembershipBranchSchema.parse({ id: 0, name: 'x' })).toThrow()
    expect(() => MembershipBranchListSchema.parse({ items: [company] })).toThrow()
    expect(() => MembershipBranchListSchema.parse({ items: [company], total: -1 })).toThrow()
    expect(() => MembershipBranchListSchema.parse({ items: [company], total: 1, next: 2 })).toThrow()
  })
})

describe('membership inputs', () => {
  it('adds by email with roles, with none, and with the optional company and employee', () => {
    expect(MembershipInputSchema.parse({ login: ' sara@example.com ', assignments: [grant] })).toEqual({ login: 'sara@example.com', assignments: [grant] })
    expect(MembershipInputSchema.parse({ login: 'sara@example.com', assignments: [] }).assignments).toEqual([])
    expect(MembershipInputSchema.parse({ login: 'sara@example.com', assignments: [grant], company_id: 3, employee_id: 11 }).employee_id).toBe(11)
  })

  it('refuses what the server refuses', () => {
    expect(() => MembershipInputSchema.parse({ login: 'sara', assignments: [] })).toThrow()
    expect(() => MembershipInputSchema.parse({ login: 'sara@example.com' })).toThrow()
    expect(() => MembershipInputSchema.parse({ login: 'sara@example.com', assignments: [grant, grant] })).toThrow()
    expect(() => MembershipInputSchema.parse({ login: 'sara@example.com', assignments: [], company_id: 0 })).toThrow()
    expect(() => MembershipInputSchema.parse({ login: 'sara@example.com', assignments: [], name: 'Sara' })).toThrow()
  })

  it('replaces roles under a version, which may leave none', () => {
    expect(MembershipRolesInputSchema.parse({ expected_version: 'm3-u7-r5', assignments: [] }).assignments).toEqual([])
    expect(MembershipRolesInputSchema.parse({ expected_version: 'm3-u7-r5', assignments: [grant], company_id: 3 }).company_id).toBe(3)
    expect(() => MembershipRolesInputSchema.parse({ assignments: [] })).toThrow()
    expect(() => MembershipRolesInputSchema.parse({ expected_version: ' ', assignments: [] })).toThrow()
  })

  it('names the branch of a list or a removal in the query', () => {
    expect(MembershipQuerySchema.parse({})).toEqual({})
    expect(MembershipQuerySchema.parse({ company_id: 3 })).toEqual({ company_id: 3 })
    expect(() => MembershipQuerySchema.parse({ company_id: 3, limit: 5 })).toThrow()
  })
})

describe('account_exists details', () => {
  it('carries the name and the home company of the existing account and nothing else', () => {
    const details = { existing_account: { name: 'Sara', home_company: home } }
    expect(ExistingAccountDetailsSchema.parse(details)).toEqual(details)
    expect(() => ExistingAccountDetailsSchema.parse({ existing_account: { name: 'Sara', home_company: home, login: 'sara@example.com' } })).toThrow()
    expect(() => ExistingAccountDetailsSchema.parse({ existing_account: { name: 'Sara' } })).toThrow()
  })
})

describe('membership audit actions', () => {
  it('are part of the access log enum', () => {
    for (const action of ['user.employee_unlinked', 'user.membership_added', 'user.membership_roles_changed', 'user.membership_removed']) {
      expect(AuditActionSchema.parse(action)).toBe(action)
    }
  })
})
