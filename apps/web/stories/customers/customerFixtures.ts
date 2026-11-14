import type { Customer, CustomerSettings } from '@liwan/contracts'

// The wire shapes the customers stories share: phones are E.164, and a customer carries the tenant's fields with its values.
export const settings: CustomerSettings = {
  sharing: 'branch',
  party_kinds: 'both',
  phone_country: { id: 191, code: 'SA', name: 'المملكة العربية السعودية' },
  fields: [
    { key: 'city', label: 'المدينة', type: 'char' },
    { key: 'vip', label: 'عميل مميز', type: 'boolean' },
    { key: 'tier', label: 'الفئة', type: 'selection', options: [{ key: 'gold', label: 'ذهبية' }, { key: 'silver', label: 'فضية' }] },
  ],
  field_limits: { max_properties: 20, max_options: 50, max_label: 100 },
  can_manage: true,
  revision: 3,
}

export const customers: Customer[] = [
  { id: 1, name: 'منى العتيبي', erased: false, phone: '+966500000001', email: 'mona@example.com', is_company: false, parent: null, active: true, company: { id: 1, name: 'فرع الرياض' }, properties: [{ key: 'city', label: 'المدينة', type: 'char', value: 'الرياض' }] },
  { id: 2, name: 'مؤسسة النخيل للتجارة', erased: false, phone: '+966500000002', email: null, is_company: true, parent: null, active: true, company: null, properties: [] },
  { id: 3, name: 'سارة الحربي', erased: false, phone: null, email: 'sara@example.com', is_company: false, parent: { id: 2, name: 'مؤسسة النخيل للتجارة' }, active: false, company: { id: 1, name: 'فرع الرياض' }, properties: [] },
]
