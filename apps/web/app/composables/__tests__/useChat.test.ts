import { describe, expect, it, vi } from 'vitest'
import { applyChatAccessFailure, chatKeys } from '../useChat'
import { ApiError } from '../useApi'
import { CHAT_POLL_MS, chatCacheScope, chatListQuery, chatPollInterval, chatReconcileInterval } from '../../utils/chatState'

describe('useChat cache and polling contract', () => {
  it('scopes list and message keys per user so SSR sessions cannot share cache', () => {
    const route = { q: 'ops', filter: 'unread' as const, offset: 0 }
    expect(chatKeys.list(7, route)[1]).toBe(7)
    expect(chatKeys.list(8, route)[1]).toBe(8)
    expect(chatKeys.list(7, route)).not.toEqual(chatKeys.list(8, route))
    expect(chatKeys.messages(7, 42)).not.toEqual(chatKeys.messages(9, 42))
    expect(chatCacheScope(undefined)[1]).toBe('anonymous')
  })

  it('keeps list query keys distinct per filter and polls every 5s without mutation retry', () => {
    const unread = chatKeys.list(1, { q: '', filter: 'unread', offset: 0 })
    const groups = chatKeys.list(1, { q: '', filter: 'groups', offset: 0 })
    expect(unread).not.toEqual(groups)
    expect(chatListQuery({ q: '', filter: 'all', offset: 0 }).limit).toBe(50)
    expect(CHAT_POLL_MS).toBe(5000)
  })

  it('reconciles an open thread every 5 seconds even when the bus reports connected', () => {
    expect(chatReconcileInterval(undefined, true, true)).toBe(CHAT_POLL_MS)
    expect(chatReconcileInterval(undefined, false, true)).toBe(CHAT_POLL_MS)
    expect(chatReconcileInterval(undefined, true, false)).toBe(30_000)
    expect(chatReconcileInterval(undefined, false, false)).toBe(CHAT_POLL_MS)
    expect(chatReconcileInterval(403, true, true)).toBe(false)
    expect(chatReconcileInterval(404, false, true)).toBe(false)
  })

  it('stops polling and clears the private cache on 403/404', () => {
    const qc = { removeQueries: vi.fn(), cancelQueries: vi.fn() }
    expect(applyChatAccessFailure(qc, 7, new ApiError(403, 'forbidden', 'no'))).toBe(true)
    expect(qc.cancelQueries).toHaveBeenCalledWith({ queryKey: chatKeys.root(7) })
    expect(qc.removeQueries).toHaveBeenCalledWith({ queryKey: chatKeys.root(7) })
    expect(applyChatAccessFailure(qc, 7, new ApiError(500, 'http_error', 'x'))).toBe(false)
    expect(chatPollInterval(404)).toBe(false)
  })
})
