import type { CrmImportMapping, CrmImportPreview, CrmSource } from '@webvue/contracts'

export const columns = ['الاسم', 'الهاتف', 'البريد', 'ملاحظات']

export const sources: CrmSource[] = [
  { id: 1, name: 'الموقع', active: true },
  { id: 2, name: 'معرض', active: true },
]

export const profiles: CrmImportMapping[] = [
  { id: 1, name: 'ملف المعرض', columns: { name: 'الاسم', phone: 'الهاتف', email: 'البريد', notes: null, package: null } },
]

export const preview: CrmImportPreview = {
  new: 3,
  duplicate: 1,
  invalid: 2,
  invalid_rows: [{ row: 6, reason: 'invalid_phone' }, { row: 9, reason: 'missing_name' }],
  duplicate_rows: [5],
}

export const cleanPreview: CrmImportPreview = { new: 120, duplicate: 0, invalid: 0, invalid_rows: [], duplicate_rows: [] }
