import { MembershipListSchema, MeSchema } from '@liwan/contracts'
import { shellMe } from './shell'

/** An administrator of the working company, who may add members and give them roles. */
export const membersMe = MeSchema.parse({
  ...shellMe,
  capabilities: [...shellMe.capabilities, 'access.users.grant', 'access.users.assign_roles', 'access.roles.read'],
})
/** The same administrator without the right to change roles: the list shows only the remove action. */
export const membersReaderMe = MeSchema.parse({ ...membersMe, capabilities: membersMe.capabilities.filter(key => key !== 'access.users.assign_roles') })

export const memberRoles = [
  { id: 4, name: { ar: 'مدير المبيعات', en: 'Sales manager' }, active: true, assignable: true },
  { id: 5, name: { ar: 'قارئ المالية', en: 'Finance reader' }, active: true, assignable: true },
]
const company = { id: 1, name: 'شركة المثال' }
const role = (id: number, key: string, ar: string, en: string) => ({ id, key, name: { ar, en }, type: 'custom' as const, protected: false })

export const membershipList = MembershipListSchema.parse({
  items: [
    {
      id: 21, name: 'نورة العتيبي', login: 'noura@example.com', home_company: { id: 2, name: 'فرع الرياض' }, company, version: 'm1',
      assignments: [{ id: 31, role: role(4, 'sales_manager', 'مدير المبيعات', 'Sales manager'), scope: { kind: 'company', id: 1, name: 'شركة المثال' } }],
    },
    { id: 22, name: 'خالد الدوسري', login: 'khaled@example.com', home_company: { id: 3, name: 'فرع جدة' }, company, version: 'm2', assignments: [] },
  ],
  total: 2,
})
export const emptyMembershipList = MembershipListSchema.parse({ items: [], total: 0 })
