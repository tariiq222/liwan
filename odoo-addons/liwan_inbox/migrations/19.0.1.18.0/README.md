A new required field `liwan.inbox.event.dedupe_key` (SHA-256 of the channel and the raw body, unique) makes one
webhook delivery stored once per channel, so a replay creates no second row and no second side effect. The
`post-` script derives the key for every event that predates the field and drops the later row of a pair the
same delivery left behind before the key existed. Nothing else changes: the event's own retention
(`PROCESSED_EVENT_DAYS`) is what ends a key's life.
