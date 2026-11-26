import {
  TelephonyBusinessHoursSchema,
  TelephonyCallListSchema,
  TelephonyCallSchema,
  TelephonyEventSchema,
  TelephonyExtensionListSchema,
  TelephonyExtensionSchema,
  TelephonyLineListSchema,
  TelephonyLineSchema,
  TelephonyLookupSchema,
  TelephonySettingsSchema,
} from '../index'

const CALL = {
  id: 7,
  linkedid: '1764049999.7',
  direction: 'out',
  state: 'ended',
  remoteNumber: '+966500000000',
  partner: { id: 4, name: 'Acme Trading' },
  user: { id: 3, name: 'Agent' },
  extension: { id: 2, name: '1001' },
  queue: null,
  startedAt: '2026-11-25T09:00:00Z',
  answeredAt: '2026-11-25T09:00:05Z',
  endedAt: '2026-11-25T09:01:00Z',
  durationSeconds: 55,
  recordingState: 'available',
  companyId: 1,
}

const EXTENSION = { id: 2, number: '1001', user: { id: 3, name: 'Agent' }, active: true }

const LINE = {
  id: 5,
  name: 'Provider trunk',
  kind: 'trunk',
  mode: 'mode_a',
  authMethod: 'credentials',
  provider: { host: 'sip.provider.example', port: 5060 },
  numbers: ['+966112223334'],
  outboundFormat: '0',
  callerId: '+966112223334',
  maxConcurrent: 10,
  state: 'registered',
}

const HOURS = {
  timezone: 'Asia/Riyadh',
  days: [{ weekday: 0, from: '09:00', to: '17:00' }],
  closedMessage: 'نعود صباحًا',
}

const SETTINGS = {
  recordingPolicy: 'always',
  announcementEnabled: true,
  retentionDays: 90,
  defaultLine: { id: 5, name: 'Provider trunk' },
  queueCount: 1,
  ivrEnabled: false,
  businessHours: HOURS,
}

const EVENT = {
  event_id: '6f1c9d3a-4b7e-4c1a-9f2d-8e5b7a0c3d14',
  database: 'liwan_acme',
  occurred_at: '2026-11-25T09:00:05.123000Z',
  source: 'ari',
  reconciled: false,
  call: {
    linkedid: '1764049999.7',
    uniqueid: '1764049999.7',
    channel: 'PJSIP/1001-00000007',
    direction: 'in',
    caller_number: '966500000000',
    connected_number: '1001',
    dialed_exten: '1001',
    state: 'answered',
    started_at: '2026-11-25T09:00:00.000000Z',
    answered_at: '2026-11-25T09:00:05.123000Z',
    ended_at: null,
  },
}

describe('TelephonyCallSchema', () => {
  it('accepts a finished call and the list envelope', () => {
    expect(TelephonyCallSchema.parse(CALL)).toEqual(CALL)
    expect(TelephonyCallListSchema.parse({ items: [CALL], total: 1 }).total).toBe(1)
  })

  it('accepts a call still running and an internal call without a remote number', () => {
    const running = { ...CALL, state: 'answered', endedAt: null, durationSeconds: null, recordingState: 'pending' }
    expect(TelephonyCallSchema.parse(running).durationSeconds).toBeNull()
    expect(TelephonyCallSchema.parse({ ...CALL, direction: 'internal', remoteNumber: null }).remoteNumber).toBeNull()
    expect(TelephonyCallSchema.parse({ ...CALL, partner: null, queue: 'sales' }).queue).toBe('sales')
  })

  it('rejects a negative duration, a non-E.164 number and an unknown state', () => {
    expect(() => TelephonyCallSchema.parse({ ...CALL, durationSeconds: -1 })).toThrow()
    for (const number of ['0500000000', '966500000000', '+9665', 'not-a-number']) {
      expect(() => TelephonyCallSchema.parse({ ...CALL, remoteNumber: number })).toThrow()
    }
    expect(() => TelephonyCallSchema.parse({ ...CALL, state: 'in_progress' })).toThrow()
    expect(() => TelephonyCallSchema.parse({ ...CALL, recordingState: 'deleted' })).toThrow()
  })

  it('rejects a datetime that is not an ISO UTC string with a Z', () => {
    for (const bad of ['2026-11-25', '2026-11-25 09:00:00', '2026-11-25T09:00:00+03:00', 'now']) {
      expect(() => TelephonyCallSchema.parse({ ...CALL, startedAt: bad })).toThrow()
    }
    expect(TelephonyCallSchema.parse({ ...CALL, startedAt: '2026-11-25T09:00:00.123Z' }).startedAt).toContain('.123')
  })

  it('rejects an extra key', () => {
    expect(() => TelephonyCallSchema.parse({ ...CALL, password: 'x' })).toThrow()
    expect(() => TelephonyCallListSchema.parse({ items: [CALL], total: 1, next: 2 })).toThrow()
  })
})

describe('the extension, line and settings shapes', () => {
  it('parses an extension and its list', () => {
    expect(TelephonyExtensionSchema.parse(EXTENSION)).toEqual(EXTENSION)
    expect(TelephonyExtensionListSchema.parse({ items: [EXTENSION], total: 1 }).total).toBe(1)
    expect(() => TelephonyExtensionSchema.parse({ ...EXTENSION, number: '10-01' })).toThrow()
    expect(() => TelephonyExtensionSchema.parse({ ...EXTENSION, password: 'x' })).toThrow()
  })

  it('parses a line and its list, and never takes a password', () => {
    expect(TelephonyLineSchema.parse(LINE)).toEqual(LINE)
    expect(TelephonyLineListSchema.parse({ items: [LINE], total: 1 }).total).toBe(1)
    expect(() => TelephonyLineSchema.parse({ ...LINE, password: 'x' })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, authMethod: 'basic' })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, provider: { host: 'SIP.Provider.Example', port: 5060 } })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, provider: { host: 'sip.provider.example', port: 70000 } })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, numbers: ['112223334'] })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, maxConcurrent: 0 })).toThrow()
  })

  it('parses the settings and refuses a permanent recording with its announcement off', () => {
    expect(TelephonySettingsSchema.parse(SETTINGS)).toEqual(SETTINGS)
    expect(TelephonySettingsSchema.parse({ ...SETTINGS, recordingPolicy: 'on_demand', announcementEnabled: false }).announcementEnabled).toBe(false)
    expect(() => TelephonySettingsSchema.parse({ ...SETTINGS, announcementEnabled: false })).toThrow()
    expect(() => TelephonySettingsSchema.parse({ ...SETTINGS, retentionDays: 0 })).toThrow()
    expect(() => TelephonySettingsSchema.parse({ ...SETTINGS, recordingPolicy: 'sometimes' })).toThrow()
    expect(TelephonyBusinessHoursSchema.parse({ ...HOURS, days: [] }).days).toEqual([])
    expect(() => TelephonyBusinessHoursSchema.parse({ ...HOURS, days: [{ weekday: 0, from: '17:00', to: '09:00' }] })).toThrow()
  })
})

describe('TelephonyEventSchema', () => {
  it('accepts the envelope pbx-agent posts, with raw numbers and microseconds', () => {
    expect(TelephonyEventSchema.parse(EVENT)).toEqual(EVENT)
    expect(TelephonyEventSchema.parse({ ...EVENT, source: 'cel', reconciled: true }).source).toBe('cel')
    expect(TelephonyEventSchema.parse({ ...EVENT, call: { ...EVENT.call, channel: null, caller_number: null } }).call.channel).toBeNull()
  })

  it('rejects a missing event_id and an unknown source', () => {
    const { event_id: _id, ...noId } = EVENT
    expect(() => TelephonyEventSchema.parse(noId)).toThrow()
    expect(() => TelephonyEventSchema.parse({ ...EVENT, source: 'ami' })).toThrow()
    expect(() => TelephonyEventSchema.parse({ ...EVENT, event_id: '' })).toThrow()
  })

  it('rejects a missing call, an unknown state and an extra key', () => {
    const { call: _call, ...noCall } = EVENT
    expect(() => TelephonyEventSchema.parse(noCall)).toThrow()
    expect(() => TelephonyEventSchema.parse({ ...EVENT, call: { ...EVENT.call, state: 'unknown' } })).toThrow()
    expect(() => TelephonyEventSchema.parse({ ...EVENT, extra: 1 })).toThrow()
    expect(() => TelephonyEventSchema.parse({ ...EVENT, call: { ...EVENT.call, extra: 1 } })).toThrow()
  })
})

describe('TelephonyLookupSchema', () => {
  it('parses a matched partner with the last calls', () => {
    const lookup = {
      number: '+966500000000',
      partner: { id: 4, name: 'Acme Trading', isCompany: true, company: null },
      calls: [CALL],
    }
    expect(TelephonyLookupSchema.parse(lookup)).toEqual(lookup)
  })

  it('parses an unknown number with no partner and no calls', () => {
    expect(TelephonyLookupSchema.parse({ number: '+966500000000', partner: null, calls: [] }).partner).toBeNull()
    expect(() => TelephonyLookupSchema.parse({ number: '0500000000', partner: null, calls: [] })).toThrow()
    expect(() => TelephonyLookupSchema.parse({ number: '+966500000000', partner: null, calls: [], extra: 1 })).toThrow()
  })
})
