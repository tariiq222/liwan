import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import type { MailDomain } from '@liwan/contracts'
import MailDomainCard from '../../app/components/settings/MailDomainCard.vue'
import { storyContext } from '../support/context'

// The tenant's own sending domain in its four states: not started (domain and sender name), waiting for the three DNS
// records (copy each, verify), verified (sender, test send, remove; usage only near the daily ceiling) and failed.
const domain = (overrides: Partial<MailDomain> = {}): MailDomain => ({
  state: 'not_started', domain: null, from_local_part: null, sender_address: null, records: [],
  return_path_expires_at: null, return_path_recreated_at: null, verified_at: null, last_error: null,
  paused: false, pause_reason: null, provider_configured: true, ...overrides,
})
const RECORDS: MailDomain['records'] = [
  { kind: 'dkim', type: 'CNAME', name: 'k1._domainkey.example.com', value: 'k1.dkim.oci.example.com' },
  { kind: 'spf', type: 'TXT', name: 'example.com', value: 'v=spf1 include:spf.oci.example.com ~all' },
  { kind: 'return_path', type: 'CNAME', name: 'bounce.example.com', value: 'rp.oci.example.com' },
]
const verified = { state: 'verified', domain: 'example.com', from_local_part: 'info', sender_address: 'info@example.com', verified_at: '2026-11-16T08:00:00Z' } as const
const serve = (current: MailDomain, usage = { today: 12, ceiling: 500, near_ceiling: false, deferred: 0 }) => ({
  parameters: {
    msw: {
      handlers: {
        api: [
          http.get('/api/v1/mail/domain', () => HttpResponse.json(current)),
          http.get('/api/v1/mail/domain/usage', () => HttpResponse.json(usage)),
          http.post('/api/v1/mail/domain/start', () => HttpResponse.json(domain({ state: 'pending_dns', domain: 'example.com', from_local_part: 'info', sender_address: 'info@example.com', records: RECORDS, return_path_expires_at: '2099-01-01T00:00:00Z' }))),
          http.post('/api/v1/mail/domain/verify', () => HttpResponse.json(current)),
          http.post('/api/v1/mail/domain/test-send', () => HttpResponse.json({ mail_id: 1, state: 'outgoing' })),
          http.delete('/api/v1/mail/domain', () => HttpResponse.json(domain())),
        ],
      },
    },
  },
})

const meta = {
  title: 'Settings/MailDomainCard',
  component: MailDomainCard,
  parameters: {
    layout: 'padded',
    ...storyContext('apps/web/app/pages/settings/company/index.vue:69', 'بطاقة نطاق البريد في إعدادات الشركة: أربع حالات، لم يبدأ وبانتظار سجلات النطاق وموثّق وفاشل، مع نسخ كل سجل وتأكيد الإزالة داخل الصفحة، وعرض الاستخدام عند الاقتراب من الحد اليومي فقط.'),
  },
} satisfies Meta<typeof MailDomainCard>
export default meta
type Story = StoryObj<typeof meta>

export const NotStarted: Story = { name: 'لم يبدأ', ...serve(domain()) }
export const PendingDns: Story = {
  name: 'بانتظار سجلات النطاق',
  ...serve(domain({ state: 'pending_dns', domain: 'example.com', from_local_part: 'info', sender_address: 'info@example.com', records: RECORDS, return_path_expires_at: '2099-01-01T00:00:00Z', return_path_recreated_at: '2026-11-15T10:00:00Z' })),
}
export const Verified: Story = { name: 'موثّق', ...serve(domain(verified)) }
export const VerifiedNearCeiling: Story = {
  name: 'موثّق قرب الحد اليومي',
  ...serve(domain({ ...verified, paused: true, pause_reason: 'ارتفاع نسبة الارتداد' }), { today: 480, ceiling: 500, near_ceiling: true, deferred: 7 }),
}
export const Failed: Story = { name: 'فشل التوثيق', ...serve(domain({ state: 'failed', domain: 'example.com', from_local_part: 'info', sender_address: 'info@example.com', last_error: 'لم يعد سجل DKIM يطابق القيمة المطلوبة.' })) }
