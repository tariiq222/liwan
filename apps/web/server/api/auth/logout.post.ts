export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const { odooUrl } = useRuntimeConfig(event)
  const cookie = getHeader(event, 'cookie') ?? ''
  await fetch(`${odooUrl}/web/session/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {} }),
  }).catch(() => undefined)
  deleteCookie(event, 'session_id', { path: '/' })
  setResponseStatus(event, 204)
  return null
})
