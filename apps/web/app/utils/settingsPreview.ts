import type { AccessAuditSummary, AdminUserSummary, RoleSummary } from '@webvue/contracts'
import { accessBadge } from '../components/access/accessBadge'
import { builtinRoleDescription } from './labelFallback'
import { formatWebVueDateTime } from '@webvue/ui/app/composables/calendarDate'
import type { RouteLocationRaw } from 'vue-router'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'
import { joinList } from './listFormat'

/** One row of a settings preview card: a chip (a person or an icon), a name, one muted line and at most one pill. */
export interface SettingsPreviewItem {
  id: number | string
  to: RouteLocationRaw
  name: string
  secondary?: string
  person?: { id: number; name: string }
  icon?: string
  badge?: { label: string; tone: StatusTone }
}

// The rows of the team preview cards on /settings/team: one name, one muted line and at most one pill each.
interface Labels {
  t: (key: string, ...args: never[]) => string
  te: (key: string) => boolean
  locale: string
}
const roleName = (role: { name: { ar: string; en: string | null } }, locale: string) => role.name[locale === 'ar' ? 'ar' : 'en'] ?? role.name.ar
const SEPARATOR = ' · '

export function userPreview(user: AdminUserSummary, { t, locale }: Labels): SettingsPreviewItem {
  const badge = accessBadge({ active: user.active, protected: user.protected })
  const roles = joinList(user.assignments.map(assignment => roleName(assignment.role, locale)), t) || t('access.users.noRoles')
  return { id: user.id, to: `/settings/team/users/${user.id}`, name: user.name, person: { id: user.id, name: user.name }, secondary: [user.login, roles].join(SEPARATOR), badge: { label: t(badge.labelKey), tone: badge.tone } }
}

export function rolePreview(role: RoleSummary, { t, te, locale }: Labels): SettingsPreviewItem {
  const badge = accessBadge({ active: role.active, protected: role.protected })
  const count = `${t('access.roles.columns.users')}: ${role.user_count}`
  return { id: role.id, to: `/settings/team/roles/${role.id}`, name: roleName(role, locale), icon: 'i-lucide-shield-check', secondary: [builtinRoleDescription(role, t as never, te as never), count].filter(Boolean).join(SEPARATOR), badge: { label: t(badge.labelKey), tone: badge.tone } }
}

export function eventPreview(event: AccessAuditSummary, actionLabel: string, { t, locale }: Labels): SettingsPreviewItem {
  const actor = event.actor?.name ?? t('access.audit.system')
  return { id: event.id, to: `/settings/team/access-log/${event.id}`, name: actionLabel, icon: 'i-lucide-history', secondary: [event.target.name, actor, formatWebVueDateTime(event.occurred_at, locale)].join(SEPARATOR), badge: { label: t('access.audit.succeeded'), tone: 'success' } }
}
