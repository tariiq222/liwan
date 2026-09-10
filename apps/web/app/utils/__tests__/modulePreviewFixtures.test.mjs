import { describe, expect, it } from 'vitest'
import { moduleUiPreviewData } from '../../../e2e/module-ui-preview-data.mjs'
import { AdminUserListSchema, AdminUserDetailSchema, AdminUserCandidateListSchema, RoleListSchema, RoleDetailSchema, PermissionCatalogSchema, AccessAuditListSchema, AccessAuditDetailSchema, NotificationListSchema, NotificationDigestDetailSchema } from '@nasq/contracts'
import { PersonRefSchema, HrEmployeeListSchema, HrEmployeeSchema, HrDepartmentListSchema, HrDepartmentSchema, HrDocumentListSchema, HrDocumentSchema, MeetingListSchema, MeetingDetailSchema, MeetingSeriesListSchema, MeetingSeriesDetailSchema } from '@nasq/contracts'

describe('synthetic module preview matches production read contracts',()=>{
  for (const [path,schema] of [
    ['/api/v1/people',PersonRefSchema.array()],
    ['/api/v1/hr/employees',HrEmployeeListSchema],['/api/v1/hr/employees/1',HrEmployeeSchema],
    ['/api/v1/hr/departments',HrDepartmentListSchema],['/api/v1/hr/departments/1',HrDepartmentSchema],
    ['/api/v1/hr/documents',HrDocumentListSchema],['/api/v1/hr/documents/1',HrDocumentSchema],
    ['/api/v1/meetings',MeetingListSchema],['/api/v1/meetings/1',MeetingDetailSchema],
    ['/api/v1/meeting-series',MeetingSeriesListSchema],['/api/v1/meeting-series/1',MeetingSeriesDetailSchema],
    ['/api/v1/admin/users',AdminUserListSchema],['/api/v1/admin/users/1',AdminUserDetailSchema],
    ['/api/v1/admin/users/candidates',AdminUserCandidateListSchema],
    ['/api/v1/admin/roles',RoleListSchema],['/api/v1/admin/roles/1',RoleDetailSchema],
    ['/api/v1/admin/permissions',PermissionCatalogSchema],
    ['/api/v1/admin/access-log',AccessAuditListSchema],['/api/v1/admin/access-log/1',AccessAuditDetailSchema],
    ['/api/v1/notifications',NotificationListSchema],['/api/v1/notification-digests/1',NotificationDigestDetailSchema],
  ]) it(path,()=>{
    const parsed=schema.safeParse(moduleUiPreviewData(path,new URL('http://nasq.local'+path)))
    expect(parsed.success,JSON.stringify(parsed.error)).toBe(true)
  })
})
