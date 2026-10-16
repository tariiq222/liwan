
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']
/** Socket peer addresses of the same machine, as Node reports them. */
export const LOOPBACK_PEERS = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

/**
 * The developer sign-in needs the public devLogin setting and a loopback http admin origin. NODE_ENV is not read: the local
 * production build runs with NODE_ENV=production. The control plane is the binding gate (ADMIN_DEV_LOGIN_EMAIL).
 */
export function devLoginAllowed(input: { devLogin: unknown, adminOrigin: string | undefined }): boolean {
  if (input.devLogin !== true) return false
  try {
    const origin = new URL(input.adminOrigin ?? '')
    return origin.protocol === 'http:' && LOOPBACK_HOSTS.includes(origin.hostname)
  } catch {
    return false
  }
}
