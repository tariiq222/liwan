import type { SettingsPreviewItem } from '../../app/utils/settingsPreview'

// Rows of the team preview cards, as /settings/team builds them.
export const previewRows: SettingsPreviewItem[] = [
  { id: 1, to: '/settings/team/users/1', name: 'سارة القحطاني', person: { id: 1, name: 'سارة القحطاني' }, secondary: 'sara · مدير النظام، مراجع المشاريع', badge: { label: 'نشط', tone: 'success' } },
  { id: 2, to: '/settings/team/users/2', name: 'خالد العتيبي', person: { id: 2, name: 'خالد العتيبي' }, secondary: 'khalid · بلا أدوار', badge: { label: 'موقوف', tone: 'neutral' } },
  { id: 3, to: '/settings/team/roles/3', name: 'مراجع المشاريع', icon: 'i-lucide-shield-check', secondary: 'يقرأ المشاريع والتقارير · المستخدمون: 5', badge: { label: 'نشط', tone: 'success' } },
  { id: 4, to: '/settings/team/access-log/4', name: 'أُنشئ دور', icon: 'i-lucide-history', secondary: 'مراجع المشاريع · سارة القحطاني · 15 يناير 2030 10:30' },
]
