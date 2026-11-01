import { describe, expect, it } from 'vitest'
import { governanceSections } from '../governanceSections'
import { activeGovernanceSection, activeProjectSection } from '../projectRoutes'

describe('governance sub-tabs', () => {
  it('lists the changes and baselines tabs last, each on its own top-level project path', () => {
    const sections = governanceSections(12)
    expect(sections.map(section => section.id)).toEqual(['charter', 'stakeholders', 'raci', 'register', 'changes', 'baselines'])
    expect(sections.map(section => section.to).slice(-2)).toEqual(['/projects/12/changes', '/projects/12/baselines'])
  })

  it('hides the changes tab while the company turned change control off', () => {
    expect(governanceSections(12, { changeControl: false, baselines: true }).map(section => section.id)).toEqual(['charter', 'stakeholders', 'raci', 'register', 'baselines'])
    expect(governanceSections(12, { changeControl: true, baselines: true })).toEqual(governanceSections(12))
  })

  it('hides the baselines tab while the plan lacks the sub-feature', () => {
    expect(governanceSections(12, { changeControl: true, baselines: false }).map(section => section.id)).toEqual(['charter', 'stakeholders', 'raci', 'register', 'changes'])
  })

  it('keeps the list and record pages of a baseline on the baselines tab', () => {
    for (const path of ['/projects/12/baselines', '/projects/12/baselines?offset=50', '/projects/12/baselines/2']) {
      expect(activeGovernanceSection(path), path).toBe('baselines')
      expect(activeProjectSection(path), path).toBe('governance')
    }
  })

  it('keeps the list, record, form and creation pages of a request on the changes tab', () => {
    for (const path of ['/projects/12/changes', '/projects/12/changes?state=approved', '/projects/12/changes/new', '/projects/12/changes/4', '/projects/12/changes/4/edit']) {
      expect(activeGovernanceSection(path), path).toBe('changes')
      expect(activeProjectSection(path), path).toBe('governance')
    }
  })
})
