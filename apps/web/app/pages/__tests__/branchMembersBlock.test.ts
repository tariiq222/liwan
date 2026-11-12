import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('the branch members block', () => {
  const page = read('app/pages/settings/team/branches.vue')
  it('is drawn only for a holder of access.users.grant, and only when the company has branches below it', () => {
    expect(page).toMatch(/<SharedRecordSection v-if="can\('access\.users\.grant'\) && query\.data\.value\.branches\.length" id="branch-members"/)
  })
  it('offers each branch its own roles: the company-wide ones and that branch\'s', () => {
    expect(page).toContain('role.company_id === null || role.company_id === branchId')
  })
  it('passes the branch to the list and the add form so every call names company_id', () => {
    const card = read('app/components/access/branches/BranchMembersCard.vue')
    expect(card).toContain(':company-id="props.branch.id"')
    expect(card.match(/:company-id="props\.branch\.id"/g)?.length).toBe(2)
  })
  it('keeps the member list out of the way of someone who may not grant', () => {
    expect(read('app/components/access/users/CompanyMembers.vue')).toContain('v-if="canGrant"')
    expect(read('app/pages/settings/team/users/index.vue')).toContain("v-if=\"!forbidden && can('access.users.grant')\" id=\"members\"")
  })
})
