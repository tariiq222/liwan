import { defineEventHandler, sendNoContent, setHeader, setResponseStatus, type EventHandlerRequest, type H3Event } from 'h3'

/** A failure with the exact `{ code }` body the browser receives. */
export class BffError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code)
  }
}

export const bffFail = (status: number, code: string): never => {
  throw new BffError(status, code)
}

/** Writes an upstream or local result: the status, and the body (always labelled JSON) unless it is 204. */
export function respond(event: H3Event, status: number, data?: unknown): unknown {
  if (status === 204) return sendNoContent(event)
  setResponseStatus(event, status)
  setHeader(event, 'content-type', 'application/json; charset=utf-8')
  return JSON.stringify(data ?? null)
}

/**
 * Wraps a route so a failure becomes `{ code }` with its status. Only the route name and the
 * status are logged; never an upstream body, a header, a cookie or any request material.
 */
export function bffHandler(name: string, handler: (event: H3Event<EventHandlerRequest>) => unknown | Promise<unknown>) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    } catch (error) {
      const failure = error instanceof BffError ? error : new BffError(503, 'vendor_unavailable')
      if (failure.status >= 500) console.error('vendor-admin bff', name, failure.status)
      return respond(event, failure.status, { code: failure.code })
    }
  })
}
