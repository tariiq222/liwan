import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { errorEvent, relay } from '../pump'

describe('relay', () => {
  it('swallows a failing stream push in the catch handler, closes the stream and logs only a class name', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const close = vi.fn(async () => undefined)
    const stream = { push: vi.fn(async () => { throw new Error('secret push detail') }), close, send: vi.fn(() => 'sent') }
    const event = { node: { res: Object.assign(new EventEmitter(), { writableEnded: false }) }, context: {} }
    const result = relay(event as any, {} as any, stream as any, new Response('nope', { status: 500 }))
    await new Promise(resolve => setTimeout(resolve, 50))
    process.off('unhandledRejection', unhandled)
    expect(result).toBe('sent')
    expect(stream.push).toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
    expect(unhandled).not.toHaveBeenCalled()
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret push detail')
    spy.mockRestore()
  })
})

describe('errorEvent', () => {
  it('shows a fixed text and the class name for a plain error, never its message', () => {
    const event = errorEvent(new TypeError('fetch failed: sk-secret http://10.0.0.5:8069'))
    expect(JSON.parse(event.data)).toEqual({ code: 'internal', message: 'Unexpected error (TypeError)' })
    expect(JSON.parse(errorEvent('raw string sk-secret').data)).toEqual({ code: 'internal', message: 'Unexpected error (String)' })
    expect(JSON.parse(errorEvent(null).data).message).toBe('Unexpected error (unknown)')
  })
  it('keeps the code and message of an error this server built with createError', () => {
    const error = createError({ statusCode: 503, data: { code: 'ai_unavailable', message: 'the AI service is unavailable' } })
    expect(JSON.parse(errorEvent(error).data)).toEqual({ code: 'ai_unavailable', message: 'the AI service is unavailable' })
  })
})
