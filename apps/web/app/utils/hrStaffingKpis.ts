import { kpiLink } from '@liwan/ui/app/utils/kpiLink'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import type { HrApplicantInput, HrRecruitmentJobInput } from '../composables/useHrRecruitment'
import type { HrDepartureListParams } from '../composables/useHrOffboarding'
import type { HrPlanListParams, HrRunListParams } from '../composables/useHrOnboarding'
import type { HrWarningInput } from '../composables/useHrWarnings'

type Translate = (key: string) => string

/** The `limit` of every KPI tile request: the answer's `total`, never its rows. */
const KPI_LIMIT = 1

const APPLICANTS_PATH = '/hr/recruitment'
const JOBS_PATH = '/hr/recruitment/jobs'
const ONBOARDING_PATH = '/hr/onboarding'
const OFFBOARDING_PATH = '/hr/offboarding'
const WARNINGS_PATH = '/hr/warnings'

/**
 * The applicant tiles above `/hr/recruitment`. The endpoint answers a total per `status` and exposes no
 * per-stage count (the stages list carries names only), so the strip counts the states the list already
 * filters by: every applicant, the pipeline, and the hires. The all tile reuses the list's own total while
 * the list shows every status.
 */
export function hrApplicantKpiQueries(): Record<'all' | 'ongoing' | 'hired', HrApplicantInput> {
  return {
    all: { limit: KPI_LIMIT, offset: 0 },
    ongoing: { status: 'ongoing', limit: KPI_LIMIT, offset: 0 },
    hired: { status: 'hired', limit: KPI_LIMIT, offset: 0 },
  }
}

export function hrApplicantKpiTiles(counts: { all?: number | null; ongoing?: number | null; hired?: number | null }, t: Translate): KpiTile[] {
  return [
    { id: 'all', label: t('hrRecruitment.kpi.all'), icon: 'i-lucide-users', tone: 'neutral', value: counts.all ?? null, active: false },
    {
      id: 'ongoing',
      label: t('hrRecruitment.kpi.ongoing'),
      icon: 'i-lucide-user-search',
      tone: 'neutral',
      value: counts.ongoing ?? null,
      to: kpiLink(APPLICANTS_PATH, { status: 'ongoing' }),
      clearTo: APPLICANTS_PATH,
    },
    {
      id: 'hired',
      label: t('hrRecruitment.kpi.hired'),
      icon: 'i-lucide-user-check',
      tone: 'success',
      value: counts.hired ?? null,
      to: kpiLink(APPLICANTS_PATH, { status: 'hired' }),
      clearTo: APPLICANTS_PATH,
    },
  ]
}

/** The job-position tiles: the open positions and the closed ones, matching the list's `active` filter. */
export function hrJobKpiQueries(): Record<'open' | 'closed', HrRecruitmentJobInput> {
  return {
    open: { active: 'true', limit: KPI_LIMIT, offset: 0 },
    closed: { active: 'false', limit: KPI_LIMIT, offset: 0 },
  }
}

export function hrJobKpiTiles(counts: { open?: number | null; closed?: number | null }, t: Translate): KpiTile[] {
  return [
    {
      id: 'open',
      label: t('hrRecruitment.jobs.kpi.open'),
      icon: 'i-lucide-briefcase',
      tone: 'neutral',
      value: counts.open ?? null,
      to: JOBS_PATH,
      clearTo: JOBS_PATH,
    },
    {
      id: 'closed',
      label: t('hrRecruitment.jobs.kpi.closed'),
      icon: 'i-lucide-archive',
      tone: 'neutral',
      value: counts.closed ?? null,
      to: kpiLink(JOBS_PATH, { active: 'false' }),
      clearTo: JOBS_PATH,
    },
  ]
}

/**
 * The onboarding run tiles: the runs still open and the runs already done, matching the list's `state` filter.
 * Offboarding has no runs list (its list is the departures), so the labels and links are onboarding's own.
 */
export function hrRunKpiQueries(): Record<'open' | 'done', HrRunListParams> {
  return {
    open: { state: 'open', limit: KPI_LIMIT, offset: 0 },
    done: { state: 'done', limit: KPI_LIMIT, offset: 0 },
  }
}

export function hrRunKpiTiles(counts: { open?: number | null; done?: number | null }, t: Translate): KpiTile[] {
  return [
    {
      id: 'open',
      label: t('hrOnboarding.kpi.runs.open'),
      icon: 'i-lucide-user-plus',
      tone: 'neutral',
      value: counts.open ?? null,
      to: kpiLink(ONBOARDING_PATH, { state: 'open' }),
      clearTo: ONBOARDING_PATH,
    },
    {
      id: 'done',
      label: t('hrOnboarding.kpi.runs.done'),
      icon: 'i-lucide-circle-check',
      tone: 'success',
      value: counts.done ?? null,
      to: kpiLink(ONBOARDING_PATH, { state: 'done' }),
      clearTo: ONBOARDING_PATH,
    },
  ]
}

/** The lifecycle plan tiles (onboarding and offboarding share the plan engine): the active and inactive plans. */
export function hrPlanKpiQueries(): Record<'active' | 'inactive', HrPlanListParams> {
  return {
    active: { active: 'true', limit: KPI_LIMIT, offset: 0 },
    inactive: { active: 'false', limit: KPI_LIMIT, offset: 0 },
  }
}

export function hrPlanKpiTiles(counts: { active?: number | null; inactive?: number | null }, t: Translate, namespace: string, path: string): KpiTile[] {
  return [
    {
      id: 'active',
      label: t(`${namespace}.kpi.plans.active`),
      icon: 'i-lucide-list-checks',
      tone: 'success',
      value: counts.active ?? null,
      to: path,
      clearTo: path,
    },
    {
      id: 'inactive',
      label: t(`${namespace}.kpi.plans.inactive`),
      icon: 'i-lucide-archive',
      tone: 'neutral',
      value: counts.inactive ?? null,
      to: kpiLink(path, { active: 'false' }),
      clearTo: path,
    },
  ]
}

/** The departure tiles: the clearances finished and the ones still open, matching the list's `cleared` filter. */
export function hrDepartureKpiQueries(): Record<'cleared' | 'uncleared', HrDepartureListParams> {
  return {
    cleared: { cleared: 'true', limit: KPI_LIMIT, offset: 0 },
    uncleared: { cleared: 'false', limit: KPI_LIMIT, offset: 0 },
  }
}

export function hrDepartureKpiTiles(counts: { cleared?: number | null; uncleared?: number | null }, t: Translate): KpiTile[] {
  return [
    {
      id: 'cleared',
      label: t('hrOffboarding.kpi.runs.cleared'),
      icon: 'i-lucide-circle-check',
      tone: 'success',
      value: counts.cleared ?? null,
      to: kpiLink(OFFBOARDING_PATH, { cleared: 'true' }),
      clearTo: OFFBOARDING_PATH,
    },
    {
      id: 'uncleared',
      label: t('hrOffboarding.kpi.runs.uncleared'),
      icon: 'i-lucide-list-checks',
      tone: counts.uncleared ? 'warning' : 'neutral',
      value: counts.uncleared ?? null,
      to: kpiLink(OFFBOARDING_PATH, { cleared: 'false' }),
      clearTo: OFFBOARDING_PATH,
    },
  ]
}

/**
 * The warning tiles: the three states a warning stays live in (the endpoint exposes a total per `state`; it has no
 * active or expired aggregate and no expiry date at all).
 */
export function hrWarningKpiQueries(): Record<'issued' | 'acknowledged' | 'contested', HrWarningInput> {
  return {
    issued: { state: 'issued', limit: KPI_LIMIT, offset: 0 },
    acknowledged: { state: 'acknowledged', limit: KPI_LIMIT, offset: 0 },
    contested: { state: 'contested', limit: KPI_LIMIT, offset: 0 },
  }
}

export function hrWarningKpiTiles(counts: { issued?: number | null; acknowledged?: number | null; contested?: number | null }, t: Translate): KpiTile[] {
  return [
    {
      id: 'issued',
      label: t('hrWarnings.kpi.issued'),
      icon: 'i-lucide-triangle-alert',
      tone: 'neutral',
      value: counts.issued ?? null,
      to: kpiLink(WARNINGS_PATH, { state: 'issued' }),
      clearTo: WARNINGS_PATH,
    },
    {
      id: 'acknowledged',
      label: t('hrWarnings.kpi.acknowledged'),
      icon: 'i-lucide-circle-check',
      tone: 'success',
      value: counts.acknowledged ?? null,
      to: kpiLink(WARNINGS_PATH, { state: 'acknowledged' }),
      clearTo: WARNINGS_PATH,
    },
    {
      id: 'contested',
      label: t('hrWarnings.kpi.contested'),
      icon: 'i-lucide-message-square-warning',
      tone: counts.contested ? 'warning' : 'neutral',
      value: counts.contested ?? null,
      to: kpiLink(WARNINGS_PATH, { state: 'contested' }),
      clearTo: WARNINGS_PATH,
    },
  ]
}
