# 19.0.1.19.0

No data backfill. `liwan.inbox.message` gains two nullable columns, `send_token` and `send_started_at`: the
durable marker of a send attempt in progress, written before the provider is called. Both default to NULL, so
the field definition adds them; a message that predates them was never mid-send, and the outbox only acts on
a token that a running attempt wrote itself.

`liwan.inbox.contact.consent` gains `provider_at` and `resumed_at` (both nullable): the provider timestamp of
a stop decision and of the resume that withdrew it. They make a delivery re-run idempotent, so a consent item
is not recorded twice; a decision that predates the columns simply has no provider time and keeps its current
behaviour.

The `post-` script renames the three built-in role labels to the product's name («رسائل العملاء» /
Customer Messages). Their keys, group xmlids and grants stay as they are; the records are
`noupdate="1"`, so the data file alone cannot rename them in an existing database.
