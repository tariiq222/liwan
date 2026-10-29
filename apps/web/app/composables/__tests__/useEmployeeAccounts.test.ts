import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { employeeAccountCandidateQuery } from '../useEmployeeAccounts'

describe('employee account candidates', () => {
  it('sends the status filter only when one is given', () => {
    expect(employeeAccountCandidateQuery({ status: 'active' })).toMatchObject({ status: 'active' })
    expect(employeeAccountCandidateQuery({})).not.toHaveProperty('status')
  })

  it('asks the account form picker for active employees only', () => {
    const picker = readFileSync(join(import.meta.dirname, '../../components/access/users/EmployeeAccountPicker.vue'), 'utf8')
    expect(picker).toContain("status: 'active'")
  })
})
