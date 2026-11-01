import { describe, expect, it } from 'vitest'
import { governanceSections } from '../governanceSections'
import { activeGovernanceSection, activeProjectSection } from '../projectRoutes'

describe('governance sub-tabs', () => {
  it('lists the changes, baselines and earned value tabs last, each on its own top-level project path', () => {
    const sections = governanceSections(12)
    expect(sections.map(section => section.id)).toEqual(['charter', 'stakeholders', 'raci', 'register', 'changes', 'baselines', 'evm'])
    expect(sections.map(section => section.to).slice(-3)).toEqual(['/projects/12/changes', '/projects/12/baselines', '/projects/12/evm'])
  })

  it('hides the changes tab while the company turned change control off', () => {
    expect(governanceSections(12, { changeControl: false, baselines: true, evm: true }).map(section => section.id)).toEqual(['charter', 'stakeholders', 'raci', 'register', 'baselines', 'evm'])
    expect(governanceSections(12, { changeControl: true, baselines: true, evm: true })).toEqual(governanceSections(12))
  })

  it('hides the baselines tab while the plan lacks the sub-feature', () => {
    expect(governanceSections(12, { changeControl: true, baselines: false, evm: true }).map(section => section.id)).toEqual(['charter', 'stakeholders', 'raci', 'register', 'changes', 'evm'])
  })

  it('hides the earned value tab while the plan lacks the sub-feature', () => {
    expect(governanceSections(12, { changeControl: true, baselines: true, evm: false }).map(section => section.id)).not.toContain('evm')
  })

  it('keeps the earned value page on its own tab', () => {
    expect(activeGovernanceSection('/projects/12/evm')).toBe('evm')
    expect(activeProjectSection('/projects/12/evm')).toBe('governance')
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
