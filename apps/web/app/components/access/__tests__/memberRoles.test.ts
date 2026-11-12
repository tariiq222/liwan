import { describe, expect, it } from 'vitest'
import { heldRoleOptions, isOfferable, offerableRoles, type RoleCandidate } from '../memberRoles'

const name = (label: string) => ({ ar: label, en: label })
// The users page lists roles with `assignable`; the branch policy's list has none and names the company of each role.
const usersPage: RoleCandidate[] = [
  { id: 1, name: name('Sales'), active: true, assignable: true },
  { id: 2, name: name('Off'), active: false, assignable: true },
  { id: 3, name: name('Locked'), active: true, assignable: false },
]
const branchPolicy: RoleCandidate[] = [
  { id: 1, name: name('Sales'), active: true, company_id: null },
  { id: 2, name: name('Off'), active: false, company_id: null },
  { id: 4, name: name('Own'), active: true, company_id: 7 },
  { id: 5, name: name('Other branch'), active: true, company_id: 8 },
]

describe('the roles a member can be given', () => {
  it('are the active, assignable ones of the company, whichever list they come from', () => {
    expect(offerableRoles(usersPage, undefined).map(role => role.id)).toEqual([1])
    expect(offerableRoles(branchPolicy, 7).map(role => role.id)).toEqual([1, 4])
    expect(isOfferable(usersPage[2]!, undefined)).toBe(false)
  })

  it('give both editors the same set for the same roles', () => {
    const asUsersPage = branchPolicy.map(role => ({ ...role, assignable: true }))
    expect(offerableRoles(asUsersPage, 7)).toEqual(offerableRoles(branchPolicy, 7))
  })
})

describe('the roles shown while editing one member', () => {
  const held = [{ id: 2, name: name('Off') }, { id: 3, name: name('Locked') }]
  it('always show a held role that is no longer offerable, warned, clearable while checked and not choosable once cleared', () => {
    const checked = heldRoleOptions(usersPage, undefined, held, [2, 3], 'warn')
    expect(checked.map(role => role.id)).toEqual([1, 2, 3])
    expect(checked.find(role => role.id === 2)).toMatchObject({ warning: 'warn', disabled: false })
    expect(checked.find(role => role.id === 1)?.warning).toBeUndefined()
    const cleared = heldRoleOptions(usersPage, undefined, held, [], 'warn')
    expect(cleared.find(role => role.id === 2)).toMatchObject({ warning: 'warn', disabled: true })
  })

  it('show a held role the list does not carry from the membership itself', () => {
    const options = heldRoleOptions([], undefined, [{ id: 9, name: name('Hidden') }], [9], 'warn')
    expect(options).toEqual([{ id: 9, name: name('Hidden'), warning: 'warn', disabled: false }])
  })

  it('leave out roles of another branch', () => {
    expect(heldRoleOptions(branchPolicy, 7, [], [], 'warn').map(role => role.id)).toEqual([1, 4])
  })
})
