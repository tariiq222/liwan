import { RECENT_RECORDS_COOKIE_PREFIX, recentRecordsOwner, rememberRecentRecord, savedRecentRecords, type RecentRecord, type RecentRecordsCookie } from './nav/recentRecords'

/** The records of one kind the person opened last, in a cookie so the first paint already lists them. */
export function useRecentRecords(kind: string) {
  const { me } = useMe()
  const cookie = useCookie<RecentRecordsCookie | null>(`${RECENT_RECORDS_COOKIE_PREFIX}${kind}`, { default: () => null, path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
  const stored = useState<RecentRecordsCookie | null>(`recent-records-${kind}`, () => cookie.value)
  const owner = computed(() => recentRecordsOwner(me.value?.company.id, me.value?.id))
  const items = computed(() => savedRecentRecords(stored.value, owner.value))
  function remember(record: RecentRecord) {
    if (!owner.value) return
    stored.value = { owner: owner.value, items: rememberRecentRecord(items.value, record) }
    cookie.value = stored.value
  }
  return { items, remember }
}
