import { describe, expect, it } from 'vitest'
import { PROJECT_STATUSES } from '@nasq/contracts'
import { PROJECT_STATUS_LABEL_KEY, PROJECT_STATUS_TONE, PROJECT_STATUS_UNSET_KEY, projectStatusLabelKey } from '../projectStatus'

describe('projectStatus', () => {
  it('maps every writable status to a label key and a tone', () => {
    for (const s of PROJECT_STATUSES) {
      expect(PROJECT_STATUS_LABEL_KEY[s]).toBe(`projects.status.${s}`)
      expect(PROJECT_STATUS_TONE[s]).toBeTruthy()
    }
  })
  it('null (unset) gets the muted "unset" label', () => {
    expect(projectStatusLabelKey(null)).toBe(PROJECT_STATUS_UNSET_KEY)
    expect(projectStatusLabelKey('at_risk')).toBe('projects.status.at_risk')
  })

  it('uses the shared success tone for completed projects, matching completed tasks', () => {
    expect(PROJECT_STATUS_TONE.done).toBe('success')
  })
})
