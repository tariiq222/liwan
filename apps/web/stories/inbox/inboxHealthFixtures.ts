import type { InboxBusinessProfile, InboxChannelHealth } from '@liwan/contracts'

export const activeHealth: InboxChannelHealth = {
  display_phone_number: '966500000000', verified_name: 'عيادة الأمل', name_status: 'approved', requested_name: null, name_rejection_reason: null, quality_rating: 'green',
  messaging_limit: 'tier_2k', throughput_level: 'standard', code_verified: true, account_state: 'active', account_restricted_until: null, checked_at: '2026-10-29T08:00:00Z',
  template_insights_enabled: false, currency: 'USD', analytics_synced_at: '2026-10-29T06:00:00Z', analytics_error: null,
}

export const profile: InboxBusinessProfile = {
  about: 'عيادة الأمل: رعاية أسنان لكل العائلة.', address: 'الرياض، طريق الملك فهد', description: 'نقدم خدمات الأسنان العامة والتجميلية بمواعيد مرنة طوال الأسبوع.',
  email: 'info@clinic.example.test', websites: ['https://clinic.example.test', 'https://book.clinic.example.test'], vertical: 'health', picture_url: null,
}
