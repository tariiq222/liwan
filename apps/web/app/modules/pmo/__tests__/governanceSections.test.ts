import { describe, expect, it } from 'vitest'
import { governanceSections } from '../governanceSections'
import { activeGovernanceSection, activeProjectSection } from '../projectRoutes'

describe('governance sub-tabs', () => {
  it('lists the changes tab last, on its own top-level project path', () => {
    const sections = governanceSections(12)
    expect(sections.map(section => section.id)).toEqual(['charter', 'stakeholders', 'raci', 'register', 'changes'])
    expect(sections.at(-1)?.to).toBe('/projects/12/changes')
  })

  it('hides the changes tab while the company turned change control off', () => {
    expect(governanceSections(12, { changeControl: false }).map(section => section.id)).toEqual(['charter', 'stakeholders', 'raci', 'register'])
    expect(governanceSections(12, { changeControl: true })).toEqual(governanceSections(12))
  })

  it('keeps the list, record, form and creation pages of a request on the changes tab', () => {
    for (const path of ['/projects/12/changes', '/projects/12/changes?state=approved', '/projects/12/changes/new', '/projects/12/changes/4', '/projects/12/changes/4/edit']) {
      expect(activeGovernanceSection(path), path).toBe('changes')
      expect(activeProjectSection(path), path).toBe('governance')
    }
  })
})
