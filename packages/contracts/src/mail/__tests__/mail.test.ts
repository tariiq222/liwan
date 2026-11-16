import { MailDomainSchema, MailDomainStartSchema, MailTestSendSchema, MailUsageSchema } from '../index'

const DOMAIN = {
  state: 'pending_dns',
  domain: 'example.com',
  from_local_part: 'info',
  sender_address: 'info@example.com',
  records: [
    { kind: 'dkim', type: 'CNAME', name: 'k._domainkey.example.com', value: 'k.dkim.oci.example' },
    { kind: 'spf', type: 'TXT', name: 'example.com', value: 'v=spf1 include:spf.oci.example ~all' },
    { kind: 'return_path', type: 'CNAME', name: 'rp.example.com', value: 'rp.oci.example' },
  ],
  return_path_expires_at: '2026-11-19T10:00:00Z',
  return_path_recreated_at: null,
  verified_at: null,
  last_error: null,
  paused: false,
  pause_reason: null,
  provider_configured: true,
}

describe('MailDomainSchema', () => {
  it('accepts a pending domain and a not-started one', () => {
    expect(MailDomainSchema.parse(DOMAIN)).toEqual(DOMAIN)
    const empty = { ...DOMAIN, state: 'not_started', domain: null, from_local_part: null, sender_address: null, records: [], return_path_expires_at: null }
    expect(MailDomainSchema.parse(empty).records).toEqual([])
  })

  it('rejects an unknown state, record kind, extra key or missing field', () => {
    expect(MailDomainSchema.safeParse({ ...DOMAIN, state: 'done' }).success).toBe(false)
    expect(MailDomainSchema.safeParse({ ...DOMAIN, records: [{ ...DOMAIN.records[0], kind: 'mx' }] }).success).toBe(false)
    expect(MailDomainSchema.safeParse({ ...DOMAIN, oci_id: 'x' }).success).toBe(false)
    const { paused: _paused, ...rest } = DOMAIN
    expect(MailDomainSchema.safeParse(rest).success).toBe(false)
  })
})

describe('MailDomainStartSchema', () => {
  it('trims and requires both fields', () => {
    expect(MailDomainStartSchema.parse({ domain: ' example.com ', from_local_part: ' info ' })).toEqual({ domain: 'example.com', from_local_part: 'info' })
    expect(MailDomainStartSchema.safeParse({ domain: '', from_local_part: 'info' }).success).toBe(false)
    expect(MailDomainStartSchema.safeParse({ domain: 'example.com' }).success).toBe(false)
  })
})

describe('MailTestSendSchema and MailUsageSchema', () => {
  it('are strict', () => {
    expect(MailTestSendSchema.parse({ mail_id: 4, state: 'outgoing' })).toEqual({ mail_id: 4, state: 'outgoing' })
    expect(MailTestSendSchema.safeParse({ mail_id: 4, state: 'sent', to: 'a@b.c' }).success).toBe(false)
    const usage = { today: 90, ceiling: 100, near_ceiling: true, deferred: 3 }
    expect(MailUsageSchema.parse(usage)).toEqual(usage)
    expect(MailUsageSchema.safeParse({ ...usage, today: -1 }).success).toBe(false)
  })
})
