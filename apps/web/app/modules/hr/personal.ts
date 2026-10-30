import {
  HrEmployeeSchema,
  HrEquipmentListSchema,
  HrLeaveBalanceListSchema,
  HrLeaveListSchema,
  HrMyPayslipListSchema,
  HrShiftAssignmentListSchema,
  HrShiftSettingsSchema,
} from '@liwan/contracts'
import type { AppPersonalEntry, AppPersonalSummary, AppSearchApi } from '../types'

type Translate = (key: string, params?: Record<string, unknown>) => string
const profile = (api: AppSearchApi) => api('/api/v1/hr/me', { schema: HrEmployeeSchema.nullable() })
const missingEmployee = (t: Translate): AppPersonalSummary => ({ caption: t('hr.self.noEmployeeHint') })
const requestLeave = { id: 'hr.new-leave', labelKey: 'hr.leave.new', icon: 'i-lucide-calendar-plus' as const, to: '/account/leave/new', capability: 'hr.leave.request' }

/** HR contributes only employee-owned data; the shell never imports HR components or schemas. */
export const hrPersonalEntries: AppPersonalEntry[] = [
  {
    id: 'hr-profile', section: 'profile', labelKey: 'hr.self.profile', descriptionKey: 'hr.self.profileDesc', icon: 'i-lucide-user-round',
    to: '/account/profile', capability: 'hr.employees.read',
    summary: {
      queryKey: ['hr', 'personal', 'profile'],
      async load(api, t) {
        const employee = await profile(api)
        return employee ? { value: employee.name, caption: [employee.job_title, employee.department?.name].filter(Boolean).join(' · ') } : missingEmployee(t)
      },
    },
  },
  {
    id: 'hr-leave', section: 'leave', labelKey: 'hr.self.leave', descriptionKey: 'hr.self.leaveDesc', icon: 'i-lucide-calendar-days',
    to: '/account/leave', capability: 'hr.leave.read', requiredCapabilities: ['hr.employees.read'], primaryAction: requestLeave,
    summary: {
      queryKey: ['hr', 'leave', 'personal'],
      async load(api, t) {
        if (!await profile(api)) return missingEmployee(t)
        const [balances, requests] = await Promise.all([
          api('/api/v1/hr/leave/balances', { schema: HrLeaveBalanceListSchema }),
          api('/api/v1/hr/leave/requests', { query: { mine: '1', limit: 3, offset: 0 }, schema: HrLeaveListSchema }),
        ])
        return {
          caption: balances.items.length ? balances.items.map(balance => t('hr.self.balance', { name: balance.leave_type.name, days: balance.remaining })).join(' · ') : t('hr.leave.noBalances'),
          rows: requests.items.map(leave => ({ id: leave.id, label: leave.leave_type.name, to: `/account/leave/${leave.id}`, caption: t(`hr.leave.state.${leave.state}`) })),
        }
      },
    },
  },
  {
    id: 'hr-pay', section: 'pay', labelKey: 'hr.self.pay', descriptionKey: 'hr.self.payDesc', icon: 'i-lucide-receipt',
    to: '/account/pay', capability: 'hr.employees.read', feature: 'hr.payroll',
    summary: {
      queryKey: ['hr', 'payroll', 'personal'],
      async load(api, t) {
        if (!await profile(api)) return missingEmployee(t)
        const slips = await api('/api/v1/hr/payroll/payslips/mine', { schema: HrMyPayslipListSchema })
        return { value: String(slips.total), caption: t('hr.self.approvedPayslips'), rows: slips.items.slice(0, 2).map(slip => ({ id: slip.id, label: slip.month, to: `/account/pay/${slip.id}` })) }
      },
    },
  },
  {
    id: 'hr-assets', section: 'assets', labelKey: 'hr.self.assets', descriptionKey: 'hr.self.assetsDesc', icon: 'i-lucide-package-check',
    to: '/account/assets', capability: 'hr.employees.read', feature: 'hr.assets',
    summary: {
      queryKey: ['hr', 'assets', 'personal'],
      async load(api, t) {
        if (!await profile(api)) return missingEmployee(t)
        const assets = await api('/api/v1/hr/assets/me', { schema: HrEquipmentListSchema })
        return { value: String(assets.total), caption: t('hr.self.assetsDesc'), rows: assets.items.slice(0, 3).map(asset => ({ id: asset.id, label: asset.name, to: '/account/assets', caption: asset.serial_no || undefined })) }
      },
    },
  },
  {
    id: 'hr-schedule', section: 'schedule', labelKey: 'hr.self.schedule', descriptionKey: 'hr.self.scheduleDesc', icon: 'i-lucide-calendar-clock',
    to: '/account/schedule', capability: 'hr.employees.read', feature: 'hr.shifts',
    summary: {
      queryKey: ['hr', 'shifts', 'personal'],
      async load(api, t) {
        if (!await profile(api)) return missingEmployee(t)
        const [assignments, settings] = await Promise.all([
          api('/api/v1/hr/shifts/me', { schema: HrShiftAssignmentListSchema }),
          api('/api/v1/hr/shifts/settings', { schema: HrShiftSettingsSchema }),
        ])
        const today = settings.today
        const upcoming = assignments.items.filter(item => !item.date_end || item.date_end >= today).sort((a, b) => (a.date_start ?? '').localeCompare(b.date_start ?? ''))
        return { caption: upcoming.length ? t('hr.self.scheduleDesc') : t('hrShifts.emptyMine'), rows: upcoming.slice(0, 3).map(item => ({ id: item.id, label: item.schedule.name, to: '/account/schedule', caption: item.date_start ?? t('hrShifts.rangeOpen') })) }
      },
    },
  },
]
