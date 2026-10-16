/** A one-year, same-site cookie for a display preference; Secure whenever the console is served over https. */
export function usePreferenceCookie<T extends string>(name: string, fallback: T) {
  const secure = useRequestURL().protocol === 'https:'
  return useCookie<T>(name, { default: () => fallback, path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365, secure })
}
