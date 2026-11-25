import { describe, expect, it } from 'vitest'
import {
  hrApplicantKpiQueries,
  hrApplicantKpiTiles,
  hrDepartureKpiQueries,
  hrDepartureKpiTiles,
  hrJobKpiQueries,
  hrJobKpiTiles,
  hrPlanKpiQueries,
  hrPlanKpiTiles,
  hrRunKpiQueries,
  hrRunKpiTiles,
  hrWarningKpiQueries,
  hrWarningKpiTiles,
} from '../hrStaffingKpis'

const t = (key: string) => key

describe('recruitment KPI queries', () => {
  it('asks one row per applicant state, plus the unfiltered total', () => {
    expect(hrApplicantKpiQueries()).toEqual({
      all: { limit: 1, offset: 0 },
      ongoing: { status: 'ongoing', limit: 1, offset: 0 },
      hired: { status: 'hired', limit: 1, offset: 0 },
    })
  })

  it('asks the open and the closed positions by the list filter', () => {
    expect(hrJobKpiQueries()).toEqual({
      open: { active: 'true', limit: 1, offset: 0 },
      closed: { active: 'false', limit: 1, offset: 0 },
    })
  })

  it('asks the open and the done lifecycle runs by state', () => {
    expect(hrRunKpiQueries()).toEqual({
      open: { state: 'open', limit: 1, offset: 0 },
      done: { state: 'done', limit: 1, offset: 0 },
    })
  })
})

describe('applicant tiles', () => {
  it('links each state tile to its filter and leaves the total unlinked', () => {
    const tiles = hrApplicantKpiTiles({ all: 12, ongoing: 7, hired: 3 }, t)
    expect(tiles.map(tile => [tile.id, tile.value])).toEqual([['all', 12], ['ongoing', 7], ['hired', 3]])
    expect(tiles.map(tile => tile.to)).toEqual([undefined, '/hr/recruitment?status=ongoing', '/hr/recruitment?status=hired'])
    expect(tiles.map(tile => tile.clearTo)).toEqual([undefined, '/hr/recruitment', '/hr/recruitment'])
    expect(tiles[0]).toMatchObject({ label: 'hrRecruitment.kpi.all', active: false })
    expect(tiles[2]?.tone).toBe('success')
  })

  it('shows a dash while a figure loads', () => {
    expect(hrApplicantKpiTiles({}, t).map(tile => tile.value)).toEqual([null, null, null])
  })
})

describe('job tiles', () => {
  it('keeps the open tile on the list default and clears the closed filter back to it', () => {
    const tiles = hrJobKpiTiles({ open: 4, closed: 2 }, t)
    expect(tiles.map(tile => [tile.id, tile.to, tile.clearTo])).toEqual([
      ['open', '/hr/recruitment/jobs', '/hr/recruitment/jobs'],
      ['closed', '/hr/recruitment/jobs?active=false', '/hr/recruitment/jobs'],
    ])
    expect(tiles.map(tile => tile.label)).toEqual(['hrRecruitment.jobs.kpi.open', 'hrRecruitment.jobs.kpi.closed'])
  })
})

describe('lifecycle tiles', () => {
  it('links the open and done runs to the onboarding state filter', () => {
    const tiles = hrRunKpiTiles({ open: 5, done: 9 }, t)
    expect(tiles.map(tile => [tile.id, tile.to, tile.clearTo, tile.label])).toEqual([
      ['open', '/hr/onboarding?state=open', '/hr/onboarding', 'hrOnboarding.kpi.runs.open'],
      ['done', '/hr/onboarding?state=done', '/hr/onboarding', 'hrOnboarding.kpi.runs.done'],
    ])
    expect(tiles[1]?.tone).toBe('success')
  })

  it('links the active and inactive plans of the area it is given', () => {
    expect(hrPlanKpiQueries()).toEqual({
      active: { active: 'true', limit: 1, offset: 0 },
      inactive: { active: 'false', limit: 1, offset: 0 },
    })
    const tiles = hrPlanKpiTiles({ active: 3, inactive: 1 }, t, 'hrOffboarding', '/hr/offboarding/plans')
    expect(tiles.map(tile => [tile.id, tile.to, tile.clearTo, tile.label])).toEqual([
      ['active', '/hr/offboarding/plans', '/hr/offboarding/plans', 'hrOffboarding.kpi.plans.active'],
      ['inactive', '/hr/offboarding/plans?active=false', '/hr/offboarding/plans', 'hrOffboarding.kpi.plans.inactive'],
    ])
  })
})

describe('departure tiles', () => {
  it('counts the finished clearances and the open ones', () => {
    expect(hrDepartureKpiQueries()).toEqual({
      cleared: { cleared: 'true', limit: 1, offset: 0 },
      uncleared: { cleared: 'false', limit: 1, offset: 0 },
    })
    const tiles = hrDepartureKpiTiles({ cleared: 2, uncleared: 6 }, t)
    expect(tiles.map(tile => [tile.id, tile.to, tile.clearTo])).toEqual([
      ['cleared', '/hr/offboarding?cleared=true', '/hr/offboarding'],
      ['uncleared', '/hr/offboarding?cleared=false', '/hr/offboarding'],
    ])
    expect(tiles[1]?.tone).toBe('warning')
    expect(hrDepartureKpiTiles({ uncleared: 0 }, t)[1]?.tone).toBe('neutral')
  })
})

describe('warning tiles', () => {
  it('counts the three live states the endpoint filters by', () => {
    expect(hrWarningKpiQueries()).toEqual({
      issued: { state: 'issued', limit: 1, offset: 0 },
      acknowledged: { state: 'acknowledged', limit: 1, offset: 0 },
      contested: { state: 'contested', limit: 1, offset: 0 },
    })
    const tiles = hrWarningKpiTiles({ issued: 4, acknowledged: 2, contested: 1 }, t)
    expect(tiles.map(tile => [tile.id, tile.to, tile.clearTo])).toEqual([
      ['issued', '/hr/warnings?state=issued', '/hr/warnings'],
      ['acknowledged', '/hr/warnings?state=acknowledged', '/hr/warnings'],
      ['contested', '/hr/warnings?state=contested', '/hr/warnings'],
    ])
    expect(tiles[2]?.tone).toBe('warning')
  })

  it('shows dashes and quiet tones before the figures arrive', () => {
    const tiles = hrWarningKpiTiles({}, t)
    expect(tiles.map(tile => tile.value)).toEqual([null, null, null])
    expect(tiles[2]?.tone).toBe('neutral')
  })
})
