# 19.0.1.19.0

No data change of its own. `liwan.inbox.message` gains two nullable columns, `send_token` and
`send_started_at`: the durable marker of a send attempt in progress, written before the provider is called.
Both default to NULL, so the field definition adds them and no backfill is needed; a message that predates
them was never mid-send, and the outbox only acts on a token that a running attempt wrote itself.

The `post-` script renames the three built-in role labels to the product's name («رسائل العملاء» /
Customer Messages). Their keys, group xmlids and grants stay as they are; the records are
`noupdate="1"`, so the data file alone cannot rename them in an existing database.
