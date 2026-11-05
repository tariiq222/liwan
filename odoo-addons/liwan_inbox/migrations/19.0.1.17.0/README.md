No data change. A new model `liwan.inbox.tiktok.sync` holds the steps of a TikTok account's history import
(its phase, cursor, pending conversations, counters, error and timestamps), and a new cron advances it. No
existing channel had an import to carry forward: the first one is queued when an account is connected.
