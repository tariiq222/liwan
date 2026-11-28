import {
  TelephonyCallDetailSchema,
  TelephonyCallListSchema,
  TelephonyCallSchema,
  TelephonyEventSchema,
  TelephonyExtensionListSchema,
  TelephonyExtensionSchema,
  TelephonyIceServerSchema,
  TelephonyLineListSchema,
  TelephonyLineSchema,
  TelephonyLookupSchema,
  TelephonyRecordingLinkSchema,
  TelephonyRecordingSettingsSchema,
  TelephonySessionRevokeSchema,
  TelephonySessionSchema,
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
  kind: 'sip_trunk',
  mode: 'a',
  authMethod: 'credentials',
  providerHost: 'sip.provider.example',
  providerPort: 5060,
  numbers: ['+966112223334'],
  outboundFormat: '0',
  callerId: '+966112223334',
  maxConcurrent: 10,
}

const RECORDING_LINK = {
  url: 'https://recordings.test/pbx/recordings/eyJjYWxsIjoiMSJ9.abcdef',
  expiresInSeconds: 60,
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
  it('accepts a finished call, its detail shape and the list envelope', () => {
    expect(TelephonyCallSchema.parse(CALL)).toEqual(CALL)
    expect(TelephonyCallDetailSchema.parse({ ...CALL, canListen: true })).toEqual({ ...CALL, canListen: true })
    expect(TelephonyCallListSchema.parse({ items: [CALL], total: 1 }).total).toBe(1)
  })

  it('accepts a call still running and an internal call without a remote number', () => {
    const running = { ...CALL, state: 'answered', endedAt: null, durationSeconds: null, recordingState: 'pending' }
    expect(TelephonyCallSchema.parse(running).durationSeconds).toBeNull()
    expect(TelephonyCallSchema.parse({ ...CALL, direction: 'internal', remoteNumber: null }).remoteNumber).toBeNull()
    expect(TelephonyCallSchema.parse({ ...CALL, partner: null, user: null, extension: null }).partner).toBeNull()
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

  it('rejects an extra key including removed queue', () => {
    expect(() => TelephonyCallSchema.parse({ ...CALL, queue: null })).toThrow()
    expect(() => TelephonyCallSchema.parse({ ...CALL, password: 'x' })).toThrow()
    expect(() => TelephonyCallDetailSchema.parse({ ...CALL, canListen: false, extra: 1 })).toThrow()
    expect(() => TelephonyCallListSchema.parse({ items: [CALL], total: 1, next: 2 })).toThrow()
  })
})

describe('TelephonyRecordingLinkSchema', () => {
  it('accepts a signed recording URL and positive lifetime in seconds', () => {
    expect(TelephonyRecordingLinkSchema.parse(RECORDING_LINK)).toEqual(RECORDING_LINK)
  })

  it('rejects an invalid URL, non-positive lifetime and extra keys', () => {
    expect(() => TelephonyRecordingLinkSchema.parse({ ...RECORDING_LINK, url: '/pbx/recordings/x' })).toThrow()
    expect(() => TelephonyRecordingLinkSchema.parse({ ...RECORDING_LINK, url: '' })).toThrow()
    expect(() => TelephonyRecordingLinkSchema.parse({ ...RECORDING_LINK, expiresInSeconds: 0 })).toThrow()
    expect(() => TelephonyRecordingLinkSchema.parse({ ...RECORDING_LINK, expiresInSeconds: -5 })).toThrow()
    expect(() => TelephonyRecordingLinkSchema.parse({ ...RECORDING_LINK, expiresInSeconds: 1.5 })).toThrow()
    expect(() => TelephonyRecordingLinkSchema.parse({ ...RECORDING_LINK, extra: true })).toThrow()
  })
})

describe('the extension and line shapes', () => {
  it('parses an assigned or unassigned extension and its list', () => {
    expect(TelephonyExtensionSchema.parse(EXTENSION)).toEqual(EXTENSION)
    expect(TelephonyExtensionSchema.parse({ ...EXTENSION, user: null }).user).toBeNull()
    expect(TelephonyExtensionListSchema.parse({ items: [EXTENSION], total: 1 }).total).toBe(1)
    expect(() => TelephonyExtensionSchema.parse({ ...EXTENSION, number: '10-01' })).toThrow()
    expect(() => TelephonyExtensionSchema.parse({ ...EXTENSION, password: 'x' })).toThrow()
  })

  it('parses a line and its list, supports nullable host/format/callerId and never takes a password or state', () => {
    expect(TelephonyLineSchema.parse(LINE)).toEqual(LINE)
    expect(TelephonyLineSchema.parse({
      ...LINE,
      kind: 'analog_gateway',
      mode: 'b',
      providerHost: null,
      numbers: [],
      outboundFormat: null,
      callerId: null,
    }).providerHost).toBeNull()
    expect(TelephonyLineSchema.parse({
      ...LINE,
      kind: 'mobile_gateway',
      mode: 'b',
      providerHost: '192.0.2.10',
    }).providerHost).toBe('192.0.2.10')
    expect(TelephonyLineSchema.parse({ ...LINE, providerHost: 'SIP.Provider.Example' }).providerHost).toBe('SIP.Provider.Example')
    expect(TelephonyLineListSchema.parse({ items: [LINE], total: 1 }).total).toBe(1)

    expect(() => TelephonyLineSchema.parse({ ...LINE, password: 'x' })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, state: 'registered' })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, provider: { host: 'sip.provider.example', port: 5060 } })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, kind: 'trunk' })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, mode: 'mode_a' })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, authMethod: 'basic' })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, providerHost: '-bad.example' })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, providerHost: '' })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, providerPort: 70000 })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, outboundFormat: '' })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, outboundFormat: '12345678901' })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, callerId: '0500000000' })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, numbers: ['112223334'] })).toThrow()
    expect(() => TelephonyLineSchema.parse({ ...LINE, maxConcurrent: 0 })).toThrow()
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

  it('takes call.recording only as the literal ready, and does not require it', () => {
    const ready = { ...EVENT, call: { ...EVENT.call, state: 'ended', ended_at: '2026-11-25T09:01:00Z', recording: 'ready' } }
    expect(TelephonyEventSchema.parse(ready)).toEqual(ready)
    for (const other of ['available', 'READY', 'pending', null, true, 1]) {
      expect(() => TelephonyEventSchema.parse({ ...EVENT, call: { ...EVENT.call, recording: other } })).toThrow()
    }
    expect(TelephonyEventSchema.parse(EVENT)).toEqual(EVENT)
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

const SESSION = {
  wsUrl: 'wss://pbx.example.test/ws',
  extension: '1001',
  authUsername: '1001-a1b2c3d4',
  password: 'ephemeral-password-token',
  iceServers: [
    { urls: 'stun:stun.example.test:3478' },
    { urls: ['turn:turn.example.test:3478', 'turns:turn.example.test:5349'], username: '1700000300:1001', credential: 'abc123==' },
  ],
  expiresInSeconds: 120,
}

describe('TelephonySessionSchema', () => {
  it('accepts a valid WebRTC SIP session with STUN/TURN servers and ws/wss URLs', () => {
    expect(TelephonySessionSchema.parse(SESSION)).toEqual(SESSION)
    expect(TelephonySessionSchema.parse({ ...SESSION, wsUrl: 'ws://localhost:8088/ws', iceServers: [] }).iceServers).toEqual([])
    expect(TelephonySessionSchema.parse({ ...SESSION, expiresInSeconds: 1 }).expiresInSeconds).toBe(1)
  })

  it('rejects non-websocket URLs, invalid extensions, invalid auth usernames, and out-of-range expiry', () => {
    for (const wsUrl of ['https://pbx.example.test/ws', 'http://pbx.example.test/ws', 'wss://', 'ws://', '']) {
      expect(() => TelephonySessionSchema.parse({ ...SESSION, wsUrl })).toThrow()
    }
    for (const extension of ['1', '10-01', 'abc', '12345678901']) {
      expect(() => TelephonySessionSchema.parse({ ...SESSION, extension })).toThrow()
    }
    expect(() => TelephonySessionSchema.parse({ ...SESSION, authUsername: '' })).toThrow()
    expect(() => TelephonySessionSchema.parse({ ...SESSION, authUsername: 'a'.repeat(65) })).toThrow()
    expect(() => TelephonySessionSchema.parse({ ...SESSION, password: '' })).toThrow()
    for (const expiresInSeconds of [0, -1, 121, 60.5]) {
      expect(() => TelephonySessionSchema.parse({ ...SESSION, expiresInSeconds })).toThrow()
    }
    expect(() => TelephonySessionSchema.parse({ ...SESSION, extra: true })).toThrow()
  })

  it('validates TelephonyIceServerSchema strictly', () => {
    expect(TelephonyIceServerSchema.parse({ urls: 'stun:stun.example.test:3478' })).toEqual({
      urls: 'stun:stun.example.test:3478',
    })
    expect(() => TelephonyIceServerSchema.parse({ urls: '' })).toThrow()
    expect(() => TelephonyIceServerSchema.parse({ urls: [] })).toThrow()
    expect(() => TelephonyIceServerSchema.parse({ urls: [''] })).toThrow()
    expect(() => TelephonyIceServerSchema.parse({ urls: 'stun:x', username: '' })).toThrow()
    expect(() => TelephonyIceServerSchema.parse({ urls: 'stun:x', credential: '' })).toThrow()
    expect(() => TelephonyIceServerSchema.parse({ urls: 'stun:x', extra: 1 })).toThrow()
  })
})

describe('TelephonySessionRevokeSchema', () => {
  it('accepts boolean revoked and rejects extra keys or non-boolean values', () => {
    expect(TelephonySessionRevokeSchema.parse({ revoked: true })).toEqual({ revoked: true })
    expect(TelephonySessionRevokeSchema.parse({ revoked: false })).toEqual({ revoked: false })
    expect(() => TelephonySessionRevokeSchema.parse({ revoked: 'true' })).toThrow()
    expect(() => TelephonySessionRevokeSchema.parse({ revoked: true, extension: '1001' })).toThrow()
  })
})

describe('TelephonyRecordingSettingsSchema', () => {
  const SETTINGS = { recordingPolicy: 'always', recordingAnnouncement: true, recordingRetentionDays: 90 }

  it('accepts a recording policy, the announcement flag and a retention in days', () => {
    expect(TelephonyRecordingSettingsSchema.parse(SETTINGS)).toEqual(SETTINGS)
    expect(TelephonyRecordingSettingsSchema.parse({ ...SETTINGS, recordingPolicy: 'off', recordingAnnouncement: false })).toEqual({
      recordingPolicy: 'off',
      recordingAnnouncement: false,
      recordingRetentionDays: 90,
    })
    for (const recordingRetentionDays of [1, 3650]) {
      expect(TelephonyRecordingSettingsSchema.parse({ ...SETTINGS, recordingRetentionDays }).recordingRetentionDays).toBe(recordingRetentionDays)
    }
  })

  it('rejects an unknown policy, a non-boolean announcement and an out-of-range retention', () => {
    for (const recordingPolicy of ['internal', 'Always', '']) {
      expect(() => TelephonyRecordingSettingsSchema.parse({ ...SETTINGS, recordingPolicy })).toThrow()
    }
    for (const recordingAnnouncement of ['true', 1, null]) {
      expect(() => TelephonyRecordingSettingsSchema.parse({ ...SETTINGS, recordingAnnouncement })).toThrow()
    }
    for (const recordingRetentionDays of [0, -1, 3651, 30.5, '90', null]) {
      expect(() => TelephonyRecordingSettingsSchema.parse({ ...SETTINGS, recordingRetentionDays })).toThrow()
    }
  })

  it('rejects a missing field and an extra key', () => {
    for (const field of ['recordingPolicy', 'recordingAnnouncement', 'recordingRetentionDays'] as const) {
      const { [field]: _dropped, ...without } = SETTINGS
      expect(() => TelephonyRecordingSettingsSchema.parse(without)).toThrow()
    }
    expect(() => TelephonyRecordingSettingsSchema.parse({ ...SETTINGS, extra: 1 })).toThrow()
  })
})
