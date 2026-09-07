import { describe, expect, it } from 'vitest'
import { postLoginPath, requiredCapabilityForPath } from '../accessPolicy'

describe('project report access', () => {
  it('requires project read capability for reports and cold nested links', () => {
    expect(requiredCapabilityForPath('/reports')).toBe('pmo.projects.read')
    expect(requiredCapabilityForPath('/reports/')).toBe('pmo.projects.read')
  })
  it('restores filtered report links only for project readers', () => {
    expect(postLoginPath({ capabilities: ['pmo.projects.read'] }, '/reports?q=alpha')).toBe('/reports?q=alpha')
    expect(postLoginPath({ capabilities: ['hr.employees.read'] }, '/reports?q=alpha')).toBe('/hr')
  })
})
