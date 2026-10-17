import { describe, expect, it } from 'vitest'
import { groupCapabilities } from '../capabilityGroups'

const capability = (key: string) => ({ key: key as 'hr.employees.read', sources: [] })

describe('groupCapabilities', () => {
  it('groups by domain in first-seen order and keeps every capability', () => {
    const groups = groupCapabilities([capability('hr.employees.read'), capability('pmo.tasks.read'), capability('hr.documents.read')], (key) => key.split('.')[0]!)
    expect(groups.map((group) => group.domain)).toEqual(['hr', 'pmo'])
    expect(groups[0]!.items.map((item) => item.key)).toEqual(['hr.employees.read', 'hr.documents.read'])
  })
})
