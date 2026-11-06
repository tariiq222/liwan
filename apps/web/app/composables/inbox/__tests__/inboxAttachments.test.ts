import { describe, expect, it } from 'vitest'
import { INBOX_TIKTOK_UPLOAD_ACCEPT, INBOX_UPLOAD_ACCEPT, inboxAcceptsCaption, inboxUploadAccept, inboxUploadProblem } from '../inboxAttachments'

const MIB = 1024 * 1024
const file = (type: string, size: number) => ({ type, size })
const image = (type: string, size: number) => file(type, size)

describe('a TikTok image', () => {
  it('is a JPEG or a PNG of up to 3 MB, and nothing else', () => {
    expect(inboxUploadProblem(image('image/jpeg', 2 * MIB), 'tiktok')).toBeNull()
    expect(inboxUploadProblem(image('image/png', 3 * MIB), 'tiktok')).toBeNull()
    expect(inboxUploadProblem(image('image/jpeg', 3 * MIB + 1), 'tiktok')).toEqual({ reason: 'tooLarge', limitMb: 3 })
    expect(inboxUploadProblem(image('image/gif', MIB), 'tiktok')).toEqual({ reason: 'unsupported' })
    expect(inboxUploadProblem(image('image/webp', MIB), 'tiktok')).toEqual({ reason: 'unsupported' })
    expect(inboxUploadProblem(file('application/pdf', MIB), 'tiktok')).toEqual({ reason: 'unsupported' })
    expect(inboxUploadProblem(file('video/mp4', MIB), 'tiktok')).toEqual({ reason: 'unsupported' })
  })

  it('is offered alone in the file picker', () => {
    expect(inboxUploadAccept('tiktok')).toBe(INBOX_TIKTOK_UPLOAD_ACCEPT)
    expect(inboxUploadAccept('whatsapp')).toBe(INBOX_UPLOAD_ACCEPT)
    expect(INBOX_TIKTOK_UPLOAD_ACCEPT).not.toContain('audio')
    expect(INBOX_TIKTOK_UPLOAD_ACCEPT).not.toContain('pdf')
  })

  it('carries no caption: a second text message follows it instead', () => {
    expect(inboxAcceptsCaption('image/jpeg', 'tiktok')).toBe(false)
    expect(inboxAcceptsCaption('image/jpeg', 'whatsapp')).toBe(true)
    expect(inboxAcceptsCaption('audio/ogg', 'whatsapp')).toBe(false)
  })
})
